import fs from 'node:fs'
import path from 'node:path'
import { check, ownership, parse } from '../electron/contract/graph'
import { scan } from '../electron/scan/scan'
import type { Architecture, CodeMap, Verdict } from '../shared/types'

export const OK = 0
export const VIOLATED = 1
export const USAGE = 2

export type Violation = { from: string; to: string; verdict: Verdict; evidence: { from: string; to: string }[] }

export type Args = { root: string; json: boolean; help: boolean }

const USAGE_TEXT = [
  'architect check [path] [--json]',
  '',
  '  path    directory holding architect.md (default: the working directory)',
  '  --json  emit the report as JSON',
  '',
  'exit 0 the architecture is satisfied',
  'exit 1 the code violates the drawing',
  'exit 2 bad usage, missing or malformed architect.md',
].join('\n')

export function parseArgs(argv: string[]): Args | string {
  const rest = argv[0] === 'check' ? argv.slice(1) : argv
  let root: string | undefined
  let json = false

  for (const arg of rest) {
    if (arg === '--help' || arg === '-h') return { root: process.cwd(), json: false, help: true }
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg.startsWith('-')) return `unknown option: ${arg}`
    if (root !== undefined) return `unexpected extra argument: ${arg}`
    root = arg
  }

  return { root: path.resolve(root ?? process.cwd()), json, help: false }
}

function ownersByPath(architecture: Architecture, files: string[]): Map<string, string[]> {
  const { owned, multi } = ownership(files, architecture.components)
  const map = new Map<string, string[]>()

  for (const entry of owned) map.set(entry.path, [entry.owner])
  for (const entry of multi) map.set(entry.path, entry.owners)

  return map
}

export function audit(architecture: Architecture, map: CodeMap): Violation[] {
  const files = map.folders.flatMap((folder) => folder.files)
  const owners = ownersByPath(architecture, files.map((file) => file.path))
  const found = new Map<string, Violation>()

  for (const file of files) {
    const from = owners.get(file.path) ?? []

    for (const call of file.functions.flatMap((fn) => fn.calls)) {
      if (call.file === file.path) continue
      const to = owners.get(call.file) ?? []

      for (const a of from) {
        for (const b of to) {
          if (a === b) continue
          const verdict = check(architecture, a, b)
          if (verdict.status === 'allowed') continue

          const key = `${a} -> ${b}`
          const existing = found.get(key) ?? { from: a, to: b, verdict, evidence: [] }
          if (!existing.evidence.some((e) => e.from === file.path && e.to === call.file)) {
            existing.evidence.push({ from: file.path, to: call.file })
          }
          found.set(key, existing)
        }
      }
    }
  }

  return [...found.values()].sort((a, b) => `${a.from} -> ${a.to}`.localeCompare(`${b.from} -> ${b.to}`))
}

function describe(violation: Violation): string {
  if (violation.verdict.status === 'forbidden') return `forbidden: ${violation.verdict.reason}`
  if (violation.verdict.status === 'undrawn-edge') return 'undrawn edge: the drawing has no dependency for it'
  if (violation.verdict.status === 'unknown-component') return `unknown component: ${violation.verdict.ids.join(', ')}`
  if (violation.verdict.status === 'unknown' && violation.verdict.reason) return `unknown: ${violation.verdict.reason}`
  return 'unknown'
}

export function report(architecture: Architecture, violations: Violation[]): string {
  const title = architecture.title || 'architect.md'
  if (violations.length === 0) return `architect: ${title} satisfied, no violations`

  const lines = [`architect: ${violations.length} violation${violations.length === 1 ? '' : 's'} against ${title}`, '']

  for (const violation of violations) {
    lines.push(`  ${violation.from} -> ${violation.to}`)
    lines.push(`    ${describe(violation)}`)
    for (const evidence of violation.evidence) lines.push(`    ${evidence.from} calls ${evidence.to}`)
    lines.push('')
  }

  lines.push('draw the edge in architect.md or remove the dependency from the code')
  return lines.join('\n')
}

function readContract(root: string): Architecture | string {
  let stat: fs.Stats
  try {
    stat = fs.statSync(root)
  } catch {
    return `no such directory: ${root}`
  }
  if (!stat.isDirectory()) return `not a directory: ${root}`

  const file = path.join(root, 'architect.md')
  let markdown: string
  try {
    markdown = fs.readFileSync(file, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return code === 'ENOENT' ? `no architect.md in ${root}` : `could not read ${file}: ${code ?? 'unreadable'}`
  }

  try {
    return parse(markdown)
  } catch (err) {
    return `could not parse ${file}: ${err instanceof Error ? err.message : String(err)}`
  }
}

export async function run(argv: string[], out: (line: string) => void, err: (line: string) => void): Promise<number> {
  const args = parseArgs(argv)
  if (typeof args === 'string') {
    err(args)
    err(USAGE_TEXT)
    return USAGE
  }
  if (args.help) {
    out(USAGE_TEXT)
    return OK
  }

  const architecture = readContract(args.root)
  if (typeof architecture === 'string') {
    err(architecture)
    return USAGE
  }

  const violations = audit(architecture, await scan(args.root))

  out(args.json ? JSON.stringify({ root: args.root, violations }, null, 2) : report(architecture, violations))
  return violations.length === 0 ? OK : VIOLATED
}
