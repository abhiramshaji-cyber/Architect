import { execFile } from 'node:child_process'
import path from 'node:path'
import { findCycle } from '../../shared/cycle'
import type { Architecture, CodeMap, Component, DraftResult, Edge } from '../../shared/types'
import { parse, scan, serialize } from '../contract/graph'

const TIMEOUT_MS = 5 * 60 * 1000
const MAX_OUTPUT = 8 * 1024 * 1024
const MAX_COMPONENTS = 40
const SENTENCES_PER_COMPONENT = 8
const MAX_CANDIDATES = 60
const MAX_STDERR = 400

export type ClaudeOutput = { code: number | 'missing' | 'timeout'; stdout: string; stderr: string }

export type ClaudeRun = (prompt: string, cwd: string, timeoutMs?: number) => Promise<ClaudeOutput>

export const runClaude: ClaudeRun = (prompt, cwd, timeoutMs = TIMEOUT_MS) =>
  new Promise((resolve) => {
    const options = { cwd, maxBuffer: MAX_OUTPUT, timeout: timeoutMs, windowsHide: true }

    execFile('claude', ['--print', prompt], options, (error, stdout, stderr) => {
      if (!error) return resolve({ code: 0, stdout, stderr })

      const failure = error as { code?: unknown; killed?: boolean }
      if (failure.code === 'ENOENT') return resolve({ code: 'missing', stdout, stderr })
      if (failure.killed === true) return resolve({ code: 'timeout', stdout, stderr })

      resolve({ code: typeof failure.code === 'number' ? failure.code : 1, stdout, stderr })
    })
  })

export type Sketch = {
  id: string
  dirs: string[]
  owns: string[]
  files: number
  functions: number
  sentences: string[]
}

export type Candidate = { from: string; to: string; calls: number }

export type Evidence = { components: Sketch[]; candidates: Candidate[] }

function topOf(file: string): string | null {
  const [top] = file.split('/')
  return top === undefined || top === file ? null : top
}

function idOf(top: string): string {
  return top.replaceAll('->', '-').replace(/\s+/g, '-')
}

function roundRobin(pools: string[][], limit: number): string[] {
  const taken: string[] = []
  const seen = new Set<string>()

  for (let depth = 0; taken.length < limit; depth++) {
    let any = false
    for (const pool of pools) {
      const sentence = pool[depth]
      if (sentence === undefined) continue
      any = true
      if (seen.has(sentence)) continue
      seen.add(sentence)
      taken.push(sentence)
      if (taken.length >= limit) break
    }
    if (!any) break
  }

  return taken
}

export function evidence(map: CodeMap): Evidence {
  const tops = new Map<string, { dirs: string[]; owns: string[]; files: number; functions: number; pools: string[][] }>()
  const ownerOf = new Map<string, string>()

  for (const folder of map.folders) {
    for (const file of folder.files) {
      const top = topOf(file.path)
      if (top === null) continue

      const id = idOf(top)
      const entry = tops.get(id) ?? { dirs: [], owns: [], files: 0, functions: 0, pools: [] }
      if (!entry.dirs.includes(top)) {
        entry.dirs.push(top)
        entry.owns.push(`${top}/**`)
      }
      entry.files += 1
      entry.functions += file.functions.length
      const pool = file.functions.map((fn) => fn.description.trim()).filter((d) => d !== '')
      if (pool.length > 0) entry.pools.push(pool)
      tops.set(id, entry)
      ownerOf.set(file.path, id)
    }
  }

  const counts = new Map<string, number>()
  for (const folder of map.folders) {
    for (const file of folder.files) {
      const from = ownerOf.get(file.path)
      if (from === undefined) continue
      for (const fn of file.functions) {
        for (const call of fn.calls) {
          const to = ownerOf.get(call.file)
          if (to === undefined || to === from) continue
          const key = `${from}\u0000${to}`
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
      }
    }
  }

  const components = [...tops]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, entry]) => ({
      id,
      dirs: entry.dirs,
      owns: entry.owns,
      files: entry.files,
      functions: entry.functions,
      sentences: roundRobin(entry.pools, SENTENCES_PER_COMPONENT),
    }))

  const candidates = [...counts]
    .map(([key, calls]) => {
      const [from = '', to = ''] = key.split('\u0000')
      return { from, to, calls }
    })
    .sort((a, b) => b.calls - a.calls || a.from.localeCompare(b.from) || a.to.localeCompare(b.to))

  return { components, candidates }
}

function shown(found: Evidence): Sketch[] {
  if (found.components.length <= MAX_COMPONENTS) return found.components
  return [...found.components]
    .sort((a, b) => b.files - a.files || a.id.localeCompare(b.id))
    .slice(0, MAX_COMPONENTS)
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function promptFor(found: Evidence, title: string): string {
  const components = shown(found)
  const ids = new Set(components.map((c) => c.id))
  const candidates = found.candidates.filter((c) => ids.has(c.from) && ids.has(c.to)).slice(0, MAX_CANDIDATES)

  const blocks = components.map((c) => {
    const head = `<component id="${c.id}" files="${c.files}" functions="${c.functions}" owns="${c.owns.join(' ')}">`
    const body = c.sentences.length > 0 ? c.sentences.map((s) => `- ${s}`).join('\n') : '- no descriptions available'
    return `${head}\n${body}\n</component>`
  })

  const edges =
    candidates.length > 0
      ? candidates.map((c) => `- ${c.from} -> ${c.to} (${c.calls} calls)`).join('\n')
      : '- none'

  return [
    `The repo "${title}" has no architect.md. Write the first one.`,
    '',
    'Each block below is one top level source folder Architect scanned, with a sample of the generated descriptions of the functions inside it.',
    '',
    blocks.join('\n\n'),
    '',
    'Candidate dependencies, each one an edge where a function in the first component really calls into the second, with the number of calls behind it:',
    '',
    edges,
    '',
    'Rules:',
    `- Use exactly these component ids and no others, and copy each owns glob verbatim.`,
    '- Give each component one plain sentence saying what it is for, written from the descriptions above rather than from its folder name.',
    '- Under Dependencies list only edges from the candidate list, keeping the ones that are a real dependency and leaving out the ones that are incidental.',
    '- Leave Forbidden empty. Do not invent restrictions.',
    '- Leave Packages empty.',
    '- Reply with the file and nothing else, inside one markdown fence.',
    '',
    'Format:',
    '```markdown',
    `# ${title}`,
    '',
    'One sentence saying what this repo is.',
    '',
    '## Components',
    '',
    '### id',
    'One sentence purpose.',
    'owns: `id/**`',
    '',
    '## Dependencies',
    '',
    '- from -> to',
    '',
    '## Forbidden',
    '',
    '## Packages',
    '```',
  ].join('\n')
}

function fenced(text: string): string {
  const fence = text.match(/```(?:markdown|md)?[^\S\n]*\n([\s\S]*?)```/)
  return (fence?.[1] ?? text).trim()
}

function sentence(raw: string, fallback: string): string {
  const text = raw.trim()
  if (text === '' || text.startsWith('#') || text.startsWith('-') || text.startsWith('owns:')) return fallback
  return text
}

export function validate(text: string, found: Evidence, title: string): DraftResult<string> {
  const body = fenced(text)
  if (body === '') return { ok: false, error: { kind: 'unusable', detail: 'the reply was empty' } }

  const reply = scan(body).architecture
  const owns = new Map(found.components.map((c) => [c.id, c.owns]))
  const kept = new Set<string>()
  const components: Component[] = []

  for (const c of reply.components) {
    const globs = owns.get(c.id)
    if (globs === undefined || kept.has(c.id)) continue
    kept.add(c.id)
    components.push({ id: c.id, purpose: sentence(c.purpose, `Code under ${c.id}.`), owns: globs })
  }

  if (components.length === 0) {
    return { ok: false, error: { kind: 'unusable', detail: 'no component in the reply matches a folder Architect scanned' } }
  }

  const candidates = new Set(found.candidates.map((c) => `${c.from}\u0000${c.to}`))
  const edges: Edge[] = []

  for (const e of reply.edges) {
    if (!kept.has(e.from) || !kept.has(e.to)) continue
    if (!candidates.has(`${e.from}\u0000${e.to}`)) continue
    if (edges.some((x) => x.from === e.from && x.to === e.to)) continue
    if (findCycle(edges, e.from, e.to)) continue
    edges.push(e)
  }

  const architecture: Architecture = {
    title: sentence(reply.title, title),
    summary: sentence(reply.summary, `The architecture of ${title}.`),
    components,
    edges,
    forbidden: [],
    packages: [],
  }

  const markdown = serialize(architecture)
  try {
    parse(markdown)
  } catch (err) {
    return { ok: false, error: { kind: 'unusable', detail: err instanceof Error ? err.message : String(err) } }
  }

  return { ok: true, value: markdown }
}

export function skeleton(map: CodeMap): Component[] {
  return evidence(map).components.map((c) => ({
    id: c.id,
    purpose: `Code under ${c.dirs.join(', ')}.`,
    owns: c.owns,
  }))
}

export async function draft(root: string, map: CodeMap, run: ClaudeRun = runClaude): Promise<DraftResult<string>> {
  const found = evidence(map)
  if (found.components.length === 0) return { ok: false, error: { kind: 'nothing-to-draft' } }

  const title = path.basename(root)
  const out = await run(promptFor(found, title), root)

  if (out.code === 'missing') return { ok: false, error: { kind: 'not-installed' } }
  if (out.code === 'timeout') return { ok: false, error: { kind: 'timed-out' } }
  if (out.code !== 0) {
    return { ok: false, error: { kind: 'failed', code: out.code, stderr: out.stderr.trim().slice(0, MAX_STDERR) } }
  }

  return validate(out.stdout, found, title)
}
