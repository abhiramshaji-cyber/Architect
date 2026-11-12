import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Architecture, CodeMap, FileEntry } from '../../shared/types'
import type { ClaudeRun } from '../draft/draft'
import type { SourceFacts } from '../rules/facts'
import { conventionsOf, promoteConvention, suggestedConventions, switchConventions } from '.'
import { impactOf } from './impact'
import { measured } from './measure'
import { promoted, ruleOf } from './promote'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conventions-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const facts = (file: string, lines: number): SourceFacts => ({ path: file, lines, functions: [], classes: [] })

const drawn = (owns: string[][], rules?: Architecture['rules']): Architecture => ({
  title: 't',
  summary: '',
  components: owns.map((globs, at) => ({ id: `c${at}`, purpose: 'p', owns: globs })),
  edges: [],
  forbidden: [],
  packages: [],
  ...(rules && { rules }),
})

const write = (file: string, lines: number) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  fs.writeFileSync(path.join(dir, file), 'x\n'.repeat(lines))
}

const mapOf = (...files: string[]): CodeMap => ({
  root: dir,
  scannedAt: 0,
  folders: [{ path: '', folders: [], files: files.map((file): FileEntry => ({ path: file, functions: [] })) }],
})

const on = () => fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ review: true, conventions: true }))

describe('measured', () => {
  it('offers the largest count as a rule for an area whose files all sit below the limit in force', () => {
    const found = measured(drawn([['a/**']]), [facts('a/x.ts', 40), facts('a/y.ts', 90), facts('b/z.ts', 500)])
    const lines = found.find((c) => c.rule?.startsWith('- lines'))
    expect(lines).toMatchObject({ source: 'measured', rule: '- lines: 90 `a/**`', files: ['a/y.ts'] })
    expect(found.find((c) => c.rule?.startsWith('- files'))).toBeUndefined()
  })

  it('offers nothing for a single file, an area at its limit, or a negated glob', () => {
    expect(measured(drawn([['a/**']]), [facts('a/x.ts', 40)])).toEqual([])
    expect(measured(drawn([['a/**']]), [facts('a/x.ts', 200), facts('a/y.ts', 10)]).filter((c) => c.rule?.startsWith('- lines'))).toEqual([])
    expect(measured(drawn([['a/**', '!a/y.ts']]), [facts('a/x.ts', 1), facts('a/y.ts', 1), facts('a/z.ts', 1)]).every((c) => !c.rule?.includes('!'))).toBe(true)
  })

  it('counts code files per folder against the files limit, and falls back to top folders without a contract', () => {
    const found = measured(null, [facts('a/p/x.ts', 1), facts('a/p/y.ts', 1), facts('a/q/z.ts', 1)])
    expect(found.map((c) => c.rule)).toContain('- files: 2 `a/**`')
  })

  it('never measures skipped test files', () => {
    const found = measured(drawn([['a/**']]), [facts('a/x.ts', 10), facts('a/y.ts', 20), facts('a/y.test.ts', 900)])
    expect(found.map((c) => c.rule)).toContain('- lines: 20 `a/**`')
  })
})

describe('promoted', () => {
  const contract = '# A\n\n## Rules\n\n- lines: 200\n\n## Notes\n\nhi\n'

  it('appends the rule as the last line of the Rules section, so it overrides earlier lines', () => {
    expect(promoted(contract, '- lines: 90 `a/**`')).toBe('# A\n\n## Rules\n\n- lines: 200\n- lines: 90 `a/**`\n\n## Notes\n\nhi\n')
  })

  it('adds a Rules section when there is none, and keeps CRLF line ends', () => {
    expect(promoted('# A\n', '- names: Util')).toBe('# A\n\n## Rules\n\n- names: Util\n')
    expect(promoted('# A\r\n\r\n## Rules\r\n\r\n- jobs: 1\r\n', '- jobs: 2 `a/**`')).toBe('# A\r\n\r\n## Rules\r\n\r\n- jobs: 1\r\n- jobs: 2 `a/**`\r\n')
  })

  it('refuses a malformed line, a skip or split line, and a rule already present', () => {
    expect(() => promoted(contract, 'lines 3')).toThrow(/malformed/)
    expect(() => promoted(contract, '- skip: `a/**`')).toThrow(/checks nothing/)
    expect(() => promoted(contract, '- split: 5 lines, 2 callers')).toThrow(/checks nothing/)
    expect(() => promoted(contract, '- lines: 200')).toThrow(/already a rule/)
    expect(ruleOf('- lines: 0')).toMatch(/whole number/)
  })
})

describe('impactOf', () => {
  it('lists the violations a rule adds and the ones it lifts', () => {
    const sources = [facts('a/x.ts', 300), facts('b/y.ts', 150)]
    const tighter = impactOf(undefined, sources, undefined, { rule: 'lines', limit: 100, globs: ['b/**'] })
    expect(tighter.flags.map((v) => v.path)).toEqual(['b/y.ts'])
    const looser = impactOf(undefined, sources, undefined, { rule: 'lines', limit: 400, globs: [] })
    expect(looser).toEqual({ flags: [], clears: [expect.objectContaining({ path: 'a/x.ts' })] })
  })
})

describe('the switch', () => {
  it('is off by default and loads nothing, calls no model and writes no rule while off', async () => {
    const load = vi.fn()
    const run = vi.fn<ClaudeRun>()
    fs.writeFileSync(path.join(dir, 'architect.md'), '# A\n')

    expect(await conventionsOf(dir, load)).toEqual({ enabled: false })
    await expect(suggestedConventions(dir, load, run)).rejects.toThrow(/off/)
    expect(() => promoteConvention(dir, dir, '- lines: 9')).toThrow(/off/)
    expect(load).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(fs.readFileSync(path.join(dir, 'architect.md'), 'utf8')).toBe('# A\n')
  })

  it('keeps other settings when switched, and measures once on', async () => {
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ review: true }))
    write('a/x.ts', 3)
    write('a/y.ts', 5)
    const load = async () => ({ root: dir, map: mapOf('a/x.ts', 'a/y.ts'), architecture: null })

    const state = await switchConventions(dir, true, load)
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))).toEqual({ review: true, conventions: true })
    expect(state.enabled && state.measured.map((c) => [c.rule, c.impact?.flags.length])).toContainEqual(['- lines: 5 `a/**`', 0])
    expect(await switchConventions(dir, false, load)).toEqual({ enabled: false })
  })
})

describe('suggestedConventions', () => {
  it('keeps suggestions the files back up, drops a rule it cannot read, and weighs the rest', async () => {
    on()
    write('a/x.ts', 3)
    write('a/y.ts', 300)
    const reply = {
      conventions: [
        { title: 'Small files', detail: 'd', files: ['a/x.ts', 'nope.ts'], rule: '- lines: 100 `a/**`' },
        { title: 'Odd rule', detail: 'd', files: ['a/x.ts'], rule: '- lines: many' },
        { title: 'Made up', detail: 'd', files: ['ghost.ts'], rule: '' },
        { title: 'Plain', detail: 'd', files: ['a/y.ts'], rule: '' },
      ],
    }
    const run = vi.fn<ClaudeRun>().mockResolvedValue({ code: 0, stdout: JSON.stringify(reply), stderr: '' })
    const load = async () => ({ root: dir, map: mapOf('a/x.ts', 'a/y.ts'), architecture: null })

    const result = await suggestedConventions(dir, load, run)
    expect(run).toHaveBeenCalledOnce()
    expect(run.mock.calls[0]?.[0]).toContain('a: x.ts; y.ts')
    if (!result.ok) throw new Error('expected suggestions')
    expect(result.value.map((c) => c.title)).toEqual(['Small files', 'Odd rule', 'Plain'])
    expect(result.value[0]).toMatchObject({ source: 'ai', files: ['a/x.ts'], rule: '- lines: 100 `a/**`' })
    expect(result.value[0]?.impact?.flags.map((v) => v.path)).toEqual([])
    expect(result.value[1]).toMatchObject({ unusable: expect.stringContaining('whole number') })
    expect(result.value[1]?.rule).toBeUndefined()
  })

  it('reports a missing binary and an unreadable reply', async () => {
    on()
    write('a/x.ts', 1)
    const load = async () => ({ root: dir, map: mapOf('a/x.ts'), architecture: null })
    expect(await suggestedConventions(dir, load, async () => ({ code: 'missing', stdout: '', stderr: '' }))).toEqual({ ok: false, error: { kind: 'not-installed' } })
    expect(await suggestedConventions(dir, load, async () => ({ code: 0, stdout: 'sure!', stderr: '' }))).toMatchObject({ ok: false, error: { kind: 'unusable' } })
  })
})

describe('stopping a running ask', () => {
  it('kills the model call when switched off, and reports it stopped', async () => {
    on()
    write('a/x.ts', 1)
    const load = async () => ({ root: dir, map: mapOf('a/x.ts'), architecture: null })
    let seen: AbortSignal | undefined
    const run: ClaudeRun = (_prompt, _cwd, _ms, _model, signal) =>
      new Promise((resolve) => {
        seen = signal
        signal?.addEventListener('abort', () => resolve({ code: 1, stdout: '', stderr: '' }))
      })

    const asked = suggestedConventions(dir, load, run)
    await vi.waitFor(() => expect(seen).toBeDefined())
    await switchConventions(dir, false, load)
    expect(seen?.aborted).toBe(true)
    await expect(asked).rejects.toThrow(/stopped/)
  })

  it('groups the prompt by folder inside the contract scope and accepts a ./ path', async () => {
    on()
    write('pkg/a/x.ts', 1)
    write('other/y.ts', 1)
    write('top.ts', 1)
    const run = vi.fn<ClaudeRun>().mockResolvedValue({ code: 0, stdout: JSON.stringify({ conventions: [{ title: 'T', detail: '', files: ['./top.ts'], rule: '' }] }), stderr: '' })
    const architecture = { ...drawn([]), scope: 'pkg' }
    await suggestedConventions(dir, async () => ({ root: dir, map: mapOf('pkg/a/x.ts', 'other/y.ts'), architecture }), run)
    expect(run.mock.calls[0]?.[0]).toContain('pkg/a: x.ts')
    expect(run.mock.calls[0]?.[0]).not.toContain('y.ts')

    const loose = await suggestedConventions(dir, async () => ({ root: dir, map: mapOf('top.ts'), architecture: null }), run)
    expect(loose.ok && loose.value[0]?.files).toEqual(['top.ts'])
  })
})

describe('promoteConvention', () => {
  it('writes the rule into architect.md when on, and refuses without a contract', () => {
    on()
    fs.writeFileSync(path.join(dir, 'architect.md'), '# A\n\n## Rules\n\n- lines: 200\n')
    promoteConvention(dir, dir, '- lines: 90 `a/**`')
    expect(fs.readFileSync(path.join(dir, 'architect.md'), 'utf8')).toBe('# A\n\n## Rules\n\n- lines: 200\n- lines: 90 `a/**`\n')

    fs.rmSync(path.join(dir, 'architect.md'))
    expect(() => promoteConvention(dir, dir, '- lines: 90')).toThrow(/no architect.md/)
  })
})
