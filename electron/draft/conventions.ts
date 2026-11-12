import type { Architecture, CodeMap, Convention, DraftResult } from '../../shared/types'
import { evidence } from './flow/evidence'
import { type ClaudeRun, runClaude } from './flow/run'
import { reply, scrub } from './message'

const TIMEOUT_MS = 3 * 60 * 1000
const MAX_STDERR = 400

const RULE_SYNTAX = [
  '- names: Word, Word `glob`   bans those words in file, class and function names under the glob',
  '- lines: N `glob`            at most N lines per file under the glob',
  '- files: N `glob`            at most N code files per folder under the glob',
  '- jobs: N `glob`             at most N unrelated groups of exported functions per file under the glob',
]

function filesBlock(map: CodeMap, scope: string): string[] {
  const found = evidence(map, scope)
  const names = new Map<string, string[]>()
  for (const { row } of found.functions) names.set(row.file, [...(names.get(row.file) ?? []), row.name])

  const folders = new Map<string, string[]>()
  for (const file of found.files) {
    const at = file.lastIndexOf('/')
    const folder = at === -1 ? '.' : file.slice(0, at)
    const shown = names.has(file) ? `${file.slice(at + 1)} (${names.get(file)?.join(', ')})` : file.slice(at + 1)
    folders.set(folder, [...(folders.get(folder) ?? []), shown])
  }
  return [...folders].map(([folder, files]) => `${folder}: ${files.join('; ')}`)
}

export type Known = { architecture: Architecture | null; rules: string[]; measured: Convention[] }

function promptOf(map: CodeMap, { architecture, rules, measured }: Known): string {
  const components = (architecture?.components ?? []).map((c) => `${c.id} owns ${c.owns.join(', ')}: ${c.purpose.replace(/\s+/g, ' ')}`)
  return [
    'Suggest the conventions this codebase already follows that a fixed size or naming rule does not capture, so new code can follow them too.',
    'A convention is a pattern most files of one area share: how files and functions are named, where a kind of code lives, how a folder is laid out.',
    'Only suggest a convention that the files listed below show. Name the files that show it by their full path: the folder, a slash, then the file name.',
    '',
    'Reply with one JSON object and nothing else, no prose around it and no markdown fence:',
    '{"conventions": [{"title": "...", "detail": "...", "files": ["..."], "rule": "..."}]}',
    '',
    '- title is one short line naming the convention',
    '- detail says what the files have in common, in plain words',
    '- rule is one line in the syntax below when the convention can be checked that way, and an empty string otherwise',
    '- Run no commands and read no files. Everything you need is below.',
    '',
    '<rule-syntax>',
    ...RULE_SYNTAX,
    '</rule-syntax>',
    '',
    '<rules-in-force>',
    ...(rules.length > 0 ? rules : ['the defaults']),
    '</rules-in-force>',
    '',
    '<already-measured>',
    ...(measured.length > 0 ? measured.map((c) => c.rule ?? c.title) : ['none']),
    '</already-measured>',
    '',
    '<components>',
    ...(components.length > 0 ? components : ['none drawn']),
    '</components>',
    '',
    'Each line is a folder, then its files, each with the functions Architect parsed in it.',
    '<files>',
    ...filesBlock(map, architecture?.scope ?? ''),
    '</files>',
  ].join('\n')
}

function suggestion(row: unknown, known: Set<string>): Convention | null {
  if (typeof row !== 'object' || row === null) return null
  const item = row as Record<string, unknown>
  const text = (key: string) => (typeof item[key] === 'string' ? scrub(item[key] as string) : '')
  const files = Array.isArray(item.files) ? [...new Set(item.files.flatMap((file) => (typeof file === 'string' && known.has(file.replace(/^\.\//, '')) ? [file.replace(/^\.\//, '')] : [])))] : []
  const title = text('title').split('\n')[0]?.trim() ?? ''
  if (title === '' || files.length === 0) return null

  const rule = text('rule').split('\n')[0]?.trim() ?? ''
  return { source: 'ai', title, detail: text('detail'), files, ...(rule === '' ? {} : { rule }) }
}

export async function suggestConventions(root: string, map: CodeMap, known: Known, run: ClaudeRun = runClaude, signal?: AbortSignal): Promise<DraftResult<Convention[]>> {
  const files = new Set(map.folders.flatMap((folder) => folder.files.map((file) => file.path)))
  if (files.size === 0) return { ok: false, error: { kind: 'nothing-to-draft' } }

  const out = await run(promptOf(map, known), root, TIMEOUT_MS, undefined, signal)
  if (out.code === 'missing') return { ok: false, error: { kind: 'not-installed' } }
  if (out.code === 'timeout') return { ok: false, error: { kind: 'timed-out' } }
  if (out.code !== 0) return { ok: false, error: { kind: 'failed', code: out.code, stderr: out.stderr.trim().slice(0, MAX_STDERR) } }

  const rows = reply(out.stdout)?.conventions
  if (!Array.isArray(rows)) return { ok: false, error: { kind: 'unusable', detail: 'the reply was not the JSON object that was asked for' } }

  return { ok: true, value: rows.flatMap((row) => suggestion(row, files) ?? []) }
}
