import fs from 'node:fs'
import path from 'node:path'
import { writeAgents } from '../electron/agents/write'
import { check, parse } from '../electron/contract/graph'
import { crossings } from '../electron/layers/crossings'
import { auditRules } from '../electron/rules/audit'
import { factsOf, type SourceFacts } from '../electron/rules/facts'
import { readRuns, recordRuns } from '../electron/rules/runs'
import { scan } from '../electron/scan/scan'
import { whereOf } from '../electron/where'
import { SOCKET_PATH } from '../shared/socket'
import type { Architecture, CodeMap, RuleRun } from '../shared/types'
import { parseArgs, USAGE_TEXT } from './args'
import { agentsText } from './text/agents'
import { report, type Violation } from './text/report'
import { whereText } from './text/where'

export const OK = 0
export const VIOLATED = 1
export const USAGE = 2

export function audit(architecture: Architecture, map: CodeMap): Violation[] {
  const found = new Map<string, Violation>()

  for (const { from, to, call } of crossings(map, architecture)) {
    const verdict = check(architecture, from, to)
    if (verdict.status === 'allowed') continue

    const key = `${from} -> ${to}`
    const existing = found.get(key) ?? { from, to, verdict, evidence: [] }
    if (!existing.evidence.some((e) => e.from === call.file && e.to === call.target)) {
      existing.evidence.push({ from: call.file, to: call.target })
    }
    found.set(key, existing)
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
      const outcomes = run.results.map((result) => `${result.rule} ${result.pass ? 'pass' : `fail ${result.violations}`}`)
      return `${new Date(run.at).toISOString()}  ${run.source.padEnd(12)}  ${outcomes.join(', ')}${run.file ? `  ${run.file}` : ''}`
    })
    .join('\n')
}

function readContract(root: string): Architecture | null | string {
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
    return code === 'ENOENT' ? null : `could not read ${file}: ${code ?? 'unreadable'}`
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

  if (args.command === 'where') {
    const found = whereOf(args.where ?? { calls: [], callers: [] }, { root: args.root, cwd: process.cwd(), map: await scan(args.root), architecture, stale: null })
    out(args.json ? JSON.stringify({ root: args.root, ...found }, null, 2) : whereText(found))
    return OK
  }

  if (architecture === null) {
    err(`no architect.md in ${args.root}`)
    return USAGE
  }

  if (args.command === 'agents') {
    const written = writeAgents(args.root, architecture)
    out(args.json ? JSON.stringify({ root: args.root, ...written }, null, 2) : agentsText(written))
    return OK
  }

  const map = await scan(args.root)
  const violations = audit(architecture, map)
  const rules = auditRules(architecture.rules, sourcesOf(args.root, map), architecture.scope)

  recordRuns(cacheDir, args.root, 'check', rules)

  out(args.json ? JSON.stringify({ root: args.root, violations, rules }, null, 2) : report(architecture, violations, rules))
  return violations.length === 0 && rules.length === 0 ? OK : VIOLATED
}
