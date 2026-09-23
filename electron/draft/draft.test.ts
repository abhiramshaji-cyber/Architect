import { describe, expect, it } from 'vitest'
import type { CodeMap, FileEntry } from '../../shared/types'
import { parse } from '../contract/graph'
import { type ClaudeOutput, draft, evidence, promptFor, validate } from './draft'

function fn(name: string, line: number, description: string, calls: { file: string; fn: number }[] = []) {
  return { name, line, endLine: line + 4, description, calls }
}

function file(path: string, functions: FileEntry['functions']): FileEntry {
  return { path, functions }
}

function map(files: FileEntry[]): CodeMap {
  return { root: '/repo', scannedAt: 0, folders: [{ path: '', folders: [], files }] }
}

const sample = map([
  file('ui/page.ts', [fn('page', 1, 'renders the page a visitor lands on', [{ file: 'api/handler.ts', fn: 0 }])]),
  file('api/handler.ts', [fn('handler', 1, 'answers an http request with stored rows')]),
])

const reply = [
  '```markdown',
  '# repo',
  '',
  'A tiny web app.',
  '',
  '## Components',
  '',
  '### api',
  'Answers http requests from the store.',
  'owns: `api/**`',
  '',
  '### ui',
  'Draws the pages a visitor sees.',
  'owns: `ui/**`',
  '',
  '## Dependencies',
  '',
  '- ui -> api',
  '',
  '## Forbidden',
  '',
  '## Packages',
  '```',
].join('\n')

const ok = (stdout: string): ClaudeOutput => ({ code: 0, stdout, stderr: '' })

describe('evidence', () => {
  it('groups files under their top level folder with file and function counts', () => {
    const found = evidence(sample)

    expect(found.components.map((c) => c.id)).toEqual(['api', 'ui'])
    expect(found.components.map((c) => c.owns)).toEqual([['api/**'], ['ui/**']])
    expect(found.components.map((c) => c.files)).toEqual([1, 1])
    expect(found.components.map((c) => c.functions)).toEqual([1, 1])
  })

  it('carries the generated sentences rather than the folder name', () => {
    expect(evidence(sample).components[1]?.sentences).toEqual(['renders the page a visitor lands on'])
  })

  it('aggregates call refs between folders into candidate edges with a call count', () => {
    const busy = map([
      file('ui/a.ts', [fn('a', 1, 'one', [{ file: 'api/h.ts', fn: 0 }, { file: 'api/h.ts', fn: 1 }])]),
      file('ui/b.ts', [fn('b', 1, 'two', [{ file: 'api/h.ts', fn: 0 }])]),
      file('api/h.ts', [fn('h', 1, 'three'), fn('i', 6, 'four')]),
    ])

    expect(evidence(busy).candidates).toEqual([{ from: 'ui', to: 'api', calls: 3 }])
  })

  it('leaves out calls that stay inside one folder and calls into files it never scanned', () => {
    const inside = map([
      file('ui/a.ts', [fn('a', 1, 'one', [{ file: 'ui/b.ts', fn: 0 }, { file: 'vendor/x.ts', fn: 0 }])]),
      file('ui/b.ts', [fn('b', 1, 'two')]),
    ])

    expect(evidence(inside).candidates).toEqual([])
  })

  it('finds nothing to draft from in a repo whose files all sit at the root', () => {
    expect(evidence(map([file('index.ts', [fn('go', 1, 'starts up')])])).components).toEqual([])
  })

  it('finds nothing to draft from in a scan that found no files at all', () => {
    expect(evidence(map([]))).toEqual({ components: [], candidates: [] })
  })
})

describe('promptFor', () => {
  it('sends the ids, the globs, the sentences and the candidate edges', () => {
    const text = promptFor(evidence(sample), 'repo')

    expect(text).toContain('<component id="ui" files="1" functions="1" owns="ui/**">')
    expect(text).toContain('- renders the page a visitor lands on')
    expect(text).toContain('- ui -> api (1 calls)')
  })

  it('caps how many components and sentences a very large repo sends', () => {
    const files: FileEntry[] = []
    for (let folder = 0; folder < 120; folder++) {
      for (let at = 0; at < 30; at++) {
        files.push(file(`f${folder}/m${at}.ts`, [fn(`fn${at}`, 1, `sentence ${folder} ${at}`)]))
      }
    }

    const found = evidence(map(files))
    const text = promptFor(found, 'big')
    const blocks = text.match(/<component /g) ?? []
    const sentences = text.match(/^- sentence /gm) ?? []

    expect(found.components.length).toBe(120)
    expect(blocks.length).toBe(40)
    expect(sentences.length).toBe(40 * 8)
    expect(text.length).toBeLessThan(200_000)
  })

  it('says so rather than inventing a sentence when the scan produced no descriptions', () => {
    const bare = map([file('ui/page.ts', [fn('page', 1, '')])])
    const text = promptFor(evidence(bare), 'repo')

    expect(text).toContain('<component id="ui" files="1" functions="1" owns="ui/**">')
    expect(text).toContain('- no descriptions available')
  })

  it('says there are no candidate edges rather than leaving the section blank', () => {
    const lone = map([file('ui/page.ts', [fn('page', 1, 'renders a page')])])
    expect(promptFor(evidence(lone), 'repo')).toContain('\n- none\n')
  })
})

describe('validate', () => {
  it('accepts a well formed reply and round trips it through the contract parser', () => {
    const result = validate(reply, evidence(sample), 'repo')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const architecture = parse(result.value)
    expect(architecture.title).toBe('repo')
    expect(architecture.components.map((c) => c.id)).toEqual(['api', 'ui'])
    expect(architecture.components.map((c) => c.purpose)).toEqual([
      'Answers http requests from the store.',
      'Draws the pages a visitor sees.',
    ])
    expect(architecture.edges).toEqual([{ from: 'ui', to: 'api' }])
  })

  it('reads a reply that carries no fence', () => {
    const result = validate(reply.replaceAll('```markdown\n', '').replaceAll('```', ''), evidence(sample), 'repo')
    expect(result.ok).toBe(true)
  })

  it('takes the owns globs from the scan even when the reply changed them', () => {
    const result = validate(reply.replace('owns: `ui/**`', 'owns: `everything/**`'), evidence(sample), 'repo')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(parse(result.value).components.find((c) => c.id === 'ui')?.owns).toEqual(['ui/**'])
  })

  it('drops a component the scan never found', () => {
    const invented = reply.replace('### api', '### invented\nMade up.\nowns: `invented/**`\n\n### api')
    const result = validate(invented, evidence(sample), 'repo')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(parse(result.value).components.map((c) => c.id)).toEqual(['api', 'ui'])
  })

  it('drops an edge that no call in the scanned code stands behind', () => {
    const result = validate(reply.replace('- ui -> api', '- ui -> api\n- api -> ui'), evidence(sample), 'repo')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(parse(result.value).edges).toEqual([{ from: 'ui', to: 'api' }])
  })

  it('drops an edge that would close a cycle', () => {
    const ring = map([
      file('a/x.ts', [fn('x', 1, 'one', [{ file: 'b/y.ts', fn: 0 }])]),
      file('b/y.ts', [fn('y', 1, 'two', [{ file: 'c/z.ts', fn: 0 }])]),
      file('c/z.ts', [fn('z', 1, 'three', [{ file: 'a/x.ts', fn: 0 }])]),
    ])
    const text = [
      '# ring',
      '',
      'A ring.',
      '',
      '## Components',
      '',
      '### a\nOne.\nowns: `a/**`',
      '',
      '### b\nTwo.\nowns: `b/**`',
      '',
      '### c\nThree.\nowns: `c/**`',
      '',
      '## Dependencies',
      '',
      '- a -> b',
      '- b -> c',
      '- c -> a',
      '',
      '## Forbidden',
      '',
      '## Packages',
    ].join('\n')

    const result = validate(text, evidence(ring), 'ring')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(parse(result.value).edges).toEqual([
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ])
  })

  it('never carries forbidden rules or packages the agent invented', () => {
    const extra = reply
      .replace('## Forbidden\n', '## Forbidden\n\n- ui -> api : made up\n')
      .replace('## Packages\n', '## Packages\n\n- react\n')
    const result = validate(extra, evidence(sample), 'repo')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(parse(result.value).forbidden).toEqual([])
    expect(parse(result.value).packages).toEqual([])
  })

  it('keeps one component when the reply names the same id twice', () => {
    const twice = reply.replace('### ui', '### ui\nFirst take.\nowns: `ui/**`\n\n### ui')
    const result = validate(twice, evidence(sample), 'repo')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(parse(result.value).components.map((c) => c.id)).toEqual(['api', 'ui'])
    expect(parse(result.value).components.find((c) => c.id === 'ui')?.purpose).toBe('First take.')
  })

  it('rejects a reply that is prose rather than a contract', () => {
    expect(validate('Sure, here is what I think about your repo.', evidence(sample), 'repo')).toEqual({
      ok: false,
      error: { kind: 'unusable', detail: 'no component in the reply matches a folder Architect scanned' },
    })
  })

  it('rejects an empty reply', () => {
    expect(validate('   ', evidence(sample), 'repo')).toEqual({
      ok: false,
      error: { kind: 'unusable', detail: 'the reply was empty' },
    })
  })

  it('rejects a reply whose components are all invented', () => {
    const wrong = reply.replaceAll('### api', '### nope').replaceAll('### ui', '### neither')
    expect(validate(wrong, evidence(sample), 'repo').ok).toBe(false)
  })

  it('falls back to the repo name and a plain summary when the reply gives neither', () => {
    const headless = reply.replace('# repo\n\nA tiny web app.\n\n', '')
    const result = validate(headless, evidence(sample), 'repo')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(parse(result.value).title).toBe('repo')
    expect(parse(result.value).summary).toBe('The architecture of repo.')
  })
})

describe('draft', () => {
  it('returns the validated markdown when the agent answers', async () => {
    const result = await draft('/repo', sample, async () => ok(reply))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(parse(result.value).components.map((c) => c.id)).toEqual(['api', 'ui'])
  })

  it('reports nothing to draft from and never asks the agent when the scan found no folders', async () => {
    let asked = false
    const result = await draft('/repo', map([file('index.ts', [fn('go', 1, 'starts up')])]), async () => {
      asked = true
      return ok(reply)
    })

    expect(result).toEqual({ ok: false, error: { kind: 'nothing-to-draft' } })
    expect(asked).toBe(false)
  })

  it('reports the agent as not installed', async () => {
    const result = await draft('/repo', sample, async () => ({ code: 'missing', stdout: '', stderr: '' }))
    expect(result).toEqual({ ok: false, error: { kind: 'not-installed' } })
  })

  it('reports a timed out agent', async () => {
    const result = await draft('/repo', sample, async () => ({ code: 'timeout', stdout: '', stderr: '' }))
    expect(result).toEqual({ ok: false, error: { kind: 'timed-out' } })
  })

  it('reports a failing agent with its exit code and stderr', async () => {
    const result = await draft('/repo', sample, async () => ({ code: 3, stdout: '', stderr: ' no credit left \n' }))
    expect(result).toEqual({ ok: false, error: { kind: 'failed', code: 3, stderr: 'no credit left' } })
  })

  it('runs the agent in the repo it is drafting for', async () => {
    let where = ''
    await draft('/repo', sample, async (_prompt, cwd) => {
      where = cwd
      return ok(reply)
    })
    expect(where).toBe('/repo')
  })
})
