import fs from 'node:fs'
import path from 'node:path'
import { check, ownership, parse } from '../electron/contract/graph'
import { auditRules } from '../electron/rules/audit'
import { factsOf, type SourceFacts } from '../electron/rules/facts'
import { readRuns, recordRuns } from '../electron/rules/runs'
import { scan } from '../electron/scan/scan'
import { SOCKET_PATH } from '../shared/socket'
import type { Architecture, CodeMap, RuleRun } from '../shared/types'
import { parseArgs, USAGE_TEXT } from './args'
import { report, type Violation } from './report'

export { parseArgs, report, type Violation }
export type { Args } from './args'

export const OK = 0
export const VIOLATED = 1
export const USAGE = 2

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

export function sourcesOf(root: string, map: CodeMap): SourceFacts[] {
  const read = (file: string) => () => {
    try {
      return fs.readFileSync(path.join(root, file), 'utf8')
    } catch {
      return undefined
    }
  }
  return map.folders.flatMap((folder) => folder.files.flatMap((file) => factsOf(file.path, read(file.path), () => file.functions) ?? []))
}

function history(runs: RuleRun[]): string {
  if (runs.length === 0) return 'architect: no rule runs recorded yet'

  return runs
    .map((run) => {
      const outcome = run.pass ? 'pass' : `fail ${run.violations} violation${run.violations === 1 ? '' : 's'}`
      return `${new Date(run.at).toISOString()}  ${run.source.padEnd(12)}  ${run.rule.padEnd(5)}  ${outcome}${run.file ? `  ${run.file}` : ''}`
    })
    .join('\n')
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

export async function run(
  argv: string[],
  out: (line: string) => void,
  err: (line: string) => void,
  cacheDir = path.dirname(process.env.ARCHITECT_SOCKET ?? SOCKET_PATH),
): Promise<number> {
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

  if (args.history) {
    const runs = readRuns(cacheDir, args.root)
    out(args.json ? JSON.stringify({ root: args.root, runs }, null, 2) : history(runs))
    return OK
  }

  const architecture = readContract(args.root)
  if (typeof architecture === 'string') {
    err(architecture)
    return USAGE
  }

  const map = await scan(args.root)
  const violations = audit(architecture, map)
  const rules = auditRules(architecture.rules, sourcesOf(args.root, map), architecture.scope)

  try {
    recordRuns(cacheDir, args.root, 'check', rules)
  } catch (error) {
    err(`architect: could not record the rule runs: ${error instanceof Error ? error.message : String(error)}`)
  }

  out(args.json ? JSON.stringify({ root: args.root, violations, rules }, null, 2) : report(architecture, violations, rules))
  return violations.length === 0 && rules.length === 0 ? OK : VIOLATED
}
