import fs from 'node:fs'
import path from 'node:path'
import type { Architecture, CodeMap, ContractState, Request, RuleViolation } from '../../shared/types'
import { ownership } from '../contract/graph'
import { edgesOf } from '../functions/facts'
import { proposedFile } from '../rules/proposed'
import { isTestFile } from '../scan/starts'
import { homeOf, type ComponentPick, type FolderPick } from './home'
import { projectPath, resolveRefs, type Fn, type Resolved } from './refs'
import { similarOf, type Similar } from './similar'
import { verbOf, type Verb } from './verb'

export type WhereInput = { calls: string[]; callers: string[]; name?: string; file?: string }

export type WhereContext = { root: string; cwd: string; map: CodeMap; architecture: Architecture | null; stale: string | null }

export type FileCheck = { file: string; owners: string[]; fits: boolean; violations: RuleViolation[]; stub: string; error?: string }

export type Shown = Omit<Resolved, 'fns'>

export type Where = {
  calls: Shown[]
  callers: Shown[]
  component: ComponentPick
  folder: FolderPick & { newFile: FileCheck | null }
  verb: Verb
  similar: Similar
  file: FileCheck | null
  notes: string[]
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

const counted = (ref: Resolved) => ref.status === 'function' || ref.status === 'file'

const shown = (refs: Resolved[]): Shown[] => refs.map(({ ref, status, files, matches }) => ({ ref, status, files, matches }))

function functionsOf(map: CodeMap): Fn[] {
  return map.folders
    .flatMap((folder) => folder.files)
    .flatMap((file) => file.functions.map((fn) => ({ file: file.path, name: fn.name, line: fn.line, test: isTestFile(file.path) })))
}

function stubOf(fns: Fn[], input: WhereInput, calls: Resolved[], callers: Resolved[], file: string): string {
  const name = input.name !== undefined && IDENTIFIER.test(input.name) ? input.name : 'proposed'
  const local = [...calls, ...callers].filter((ref) => ref.status === 'function' && ref.files[0] === file)
  const names = [...new Set(local.map((ref) => fns[ref.fns[0] ?? -1]?.name ?? ''))].filter((callee) => IDENTIFIER.test(callee))
  const outside = callers.filter(counted)
  const exported = outside.length === 0 || outside.some((ref) => ref.files.some((other) => other !== file))
  return `${exported ? 'export ' : ''}function ${name}() {\n${names.map((callee) => `  ${callee}()\n`).join('')}}\n`
}

function existing(target: string): string | Error {
  const stat = fs.statSync(target, { throwIfNoEntry: false })
  if (!stat) return ''
  if (!stat.isFile()) return new Error(`${target} is not a file`)
  return fs.readFileSync(target, 'utf8')
}

function fileCheck(ctx: WhereContext, target: string, stub: string): FileCheck {
  const file = projectPath(ctx.root, ctx.cwd, target)
  const owners = ctx.architecture ? ownership([file], ctx.architecture.components) : null
  const owned = owners ? [...owners.owned.map((entry) => entry.owner), ...owners.multi.flatMap((entry) => entry.owners)] : []
  try {
    const before = existing(path.resolve(ctx.cwd, target))
    if (before instanceof Error) throw before
    const content = stub === '' ? before : `${before}${before === '' || before.endsWith('\n') ? '' : '\n'}${before === '' ? '' : '\n'}${stub}`
    const { violations } = proposedFile(ctx.root, ctx.architecture?.rules, ctx.architecture?.scope, path.resolve(ctx.cwd, target), content)
    return { file, owners: owned, fits: violations.length === 0, violations, stub }
  } catch (err) {
    return { file, owners: owned, fits: false, violations: [], stub, error: err instanceof Error ? err.message : String(err) }
  }
}

function probeIn(root: string, folder: string): string {
  const dir = path.join(root, folder)
  let n = 0
  while (fs.existsSync(path.join(dir, `new${n || ''}.ts`))) n += 1
  return path.join(dir, `new${n || ''}.ts`)
}

function notesOf(ctx: WhereContext, fns: Fn[], input: WhereInput, refs: Resolved[]): string[] {
  const stale = ctx.stale === null ? [] : [`architect.md does not parse (${ctx.stale}); components and rules come from the last version that parsed`]
  const missing = ctx.architecture ? [] : ['there is no architect.md; rules are the defaults and no dependency was checked']
  const unmatched = refs.filter((ref) => ref.status === 'none').map((ref) => `${ref.ref} matched no function or file in the scan`)
  const ambiguous = refs.filter((ref) => ref.status === 'ambiguous').map((ref) => `${ref.ref} matched ${ref.matches.length} functions in different files, pass file:name to pick one: ${ref.matches.join(', ')}`)
  const taken = input.name === undefined ? [] : fns.filter((fn) => !fn.test && fn.name === input.name).map((fn) => `a function named ${fn.name} already exists at ${fn.file}:${fn.line}`)
  return [...stale, ...missing, ...unmatched, ...ambiguous, ...taken]
}

export function whereOf(input: WhereInput, ctx: WhereContext): Where {
  const fns = functionsOf(ctx.map)
  const calls = resolveRefs(fns, ctx.map, ctx.root, ctx.cwd, input.calls)
  const callers = resolveRefs(fns, ctx.map, ctx.root, ctx.cwd, input.callers)
  const files = ctx.map.folders.flatMap((folder) => folder.files.map((file) => file.path))
  const { component, folder } = homeOf(ctx.architecture, files, calls, callers)

  const target = input.file === undefined || input.file.trim() === '' ? null : input.file.trim()
  const proposed = target === null ? null : projectPath(ctx.root, ctx.cwd, target)
  return {
    calls: shown(calls),
    callers: shown(callers),
    component,
    folder: { ...folder, newFile: folder.path === null ? null : fileCheck({ ...ctx, cwd: ctx.root }, probeIn(ctx.root, folder.path), '') },
    verb: verbOf(fns, folder.path, input.name),
    similar: similarOf(fns, edgesOf(ctx.map), calls, callers),
    file: target === null || proposed === null ? null : fileCheck(ctx, target, stubOf(fns, input, calls, callers, proposed)),
    notes: notesOf(ctx, fns, input, [...calls, ...callers]),
  }
}

function inside(root: string, cwd: string): boolean {
  const relative = path.relative(root, cwd)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

export async function answerWhere(
  req: Extract<Request, { op: 'where' }>,
  roots: (string | null)[],
  load: (root: string) => { architecture: Architecture | null; contract: ContractState },
  mapOf: (root: string) => Promise<CodeMap>,
): Promise<Where> {
  const cwd = path.resolve(req.cwd)
  const root = roots.filter((candidate): candidate is string => candidate !== null && inside(candidate, cwd)).sort((a, b) => b.length - a.length)[0]
  if (root === undefined) throw new Error(`${req.cwd} is not inside a project open in Architect and no architect.md was found above it`)
  const state = load(root)
  const stale = state.contract.status === 'invalid' ? state.contract.error : null
  return whereOf(req, { root, cwd, map: await mapOf(root), architecture: state.architecture, stale })
}
