import { describe, expect, it } from 'vitest'
import type { Architecture, Ownership } from '../../shared/types'
import type { AiOutput, AiRun } from '../ai'
import { askContract, contractOf } from './ask'

const architecture: Architecture = {
  title: 'Bot',
  summary: 'A chat bot',
  components: [
    { id: 'chat', purpose: 'Takes user messages', owns: ['src/chat/**'] },
    { id: 'kb', purpose: 'Knowledge base', owns: ['src/kb/**'] },
    { id: 'llm', purpose: 'Hosted model', owns: [] },
  ],
  edges: [
    { from: 'chat', to: 'kb', label: 'search' },
    { from: 'kb', to: 'llm' },
  ],
  forbidden: [{ from: 'kb', to: 'chat', reason: 'no cycles' }],
  packages: [],
}

const ownership: Ownership = {
  owned: [
    { path: 'src/chat/a.ts', owner: 'chat' },
    { path: 'src/chat/b.ts', owner: 'chat' },
    { path: 'src/kb/c.ts', owner: 'kb' },
  ],
  unowned: ['x.ts'],
  multi: [],
  dead: [],
}

function runner(stdout: string, code: AiOutput['code'] = 0) {
  const prompts: string[] = []
  const run: AiRun = async (prompt) => {
    prompts.push(prompt)
    return { code, stdout, stderr: '', cli: 'claude' }
  }
  return { run, prompts }
}

describe('contractOf', () => {
  it('gives each component its kind, purpose and owned file count', () => {
    const parsed = JSON.parse(contractOf(architecture, ownership))
    expect(parsed.components).toEqual([
      { id: 'chat', kind: 'entry', purpose: 'Takes user messages', owns: ['src/chat/**'], files: 2 },
      { id: 'kb', kind: 'middle', purpose: 'Knowledge base', owns: ['src/kb/**'], files: 1 },
      { id: 'llm', kind: 'external', purpose: 'Hosted model', owns: [], files: 0 },
    ])
    expect(parsed.edges).toEqual(architecture.edges)
    expect(parsed.ownership).toEqual({ owned: 3, unowned: 1, multiOwned: 0, deadGlobs: 0 })
  })

  it('leaves ownership out when there is none', () => {
    const parsed = JSON.parse(contractOf(architecture, null))
    expect(parsed.ownership).toBeUndefined()
    expect(parsed.components[0].files).toBeUndefined()
  })
})

describe('askContract', () => {
  it('sends the contract, the view and the conversation, and returns the reply and view', async () => {
    const { run, prompts } = runner('{"reply": "chat searches kb.", "view": {"path": {"from": "chat", "to": "kb"}}}')
    const result = await askContract('/r', architecture, ownership, 'how does chat reach kb?', [{ asker: true, text: 'hi' }, { asker: false, text: 'hello' }], { labels: false }, run)

    expect(result).toEqual({ ok: true, value: { text: 'chat searches kb.', view: { path: { from: 'chat', to: 'kb' } } } })
    expect(prompts[0]).toContain('"id":"llm","kind":"external"')
    expect(prompts[0]).toContain('<current-view>\n{"labels":false}')
    expect(prompts[0]).toContain('<person>\nhi\n</person>\n<you>\nhello\n</you>')
    expect(prompts[0]).toContain('<question>\nhow does chat reach kb?\n</question>')
  })

  it('returns a null view when the reply has none', async () => {
    const { run } = runner('```json\n{"reply": "Not in the diagram."}\n```')
    expect(await askContract('/r', architecture, null, 'what db?', [], null, run)).toEqual({ ok: true, value: { text: 'Not in the diagram.', view: null } })
  })

  it('calls nothing for an empty question or a missing contract', async () => {
    const { run, prompts } = runner('{}')
    expect(await askContract('/r', architecture, null, '  ', [], null, run)).toEqual({ ok: false, error: { kind: 'nothing-to-draft' } })
    expect(await askContract('/r', null, null, 'why?', [], null, run)).toEqual({ ok: false, error: { kind: 'nothing-to-draft' } })
    expect(prompts).toEqual([])
  })

  it('passes a not connected run through as its failure', async () => {
    const { run } = runner('', 'not-connected')
    expect(await askContract('/r', architecture, null, 'why?', [], null, run)).toEqual({ ok: false, error: { kind: 'not-connected' } })
  })

  it('rejects a reply that is not the asked JSON', async () => {
    const { run } = runner('sure, here you go')
    const result = await askContract('/r', architecture, null, 'why?', [], null, run)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error.kind).toBe('unusable')
  })

  it('keeps only the last turns and drops malformed ones', async () => {
    const turns = [...Array.from({ length: 12 }, (_, i) => ({ asker: true, text: `q${i}` })), { text: 3 }, 'junk']
    const { run, prompts } = runner('{"reply": "ok"}')
    await askContract('/r', architecture, null, 'why?', turns, null, run)
    expect(prompts[0]).not.toContain('q3\n')
    expect(prompts[0]).toContain('q4\n')
    expect(prompts[0]).toContain('q11\n')
  })
})
