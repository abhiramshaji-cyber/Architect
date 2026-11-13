import fs from 'node:fs'
import path from 'node:path'
import { errorText } from '../../shared/text/error'
import type { Architecture, CodeMap, ContractState, Request, RuleViolation } from '../../shared/types'
import { ownership } from '../contract/graph'
import { edgesOf } from '../functions/facts'
import { proposedFile } from '../rules/proposed'
import { isTestFile } from '../scan/starts'
import { counted, homeOf, type ComponentPick, type FolderPick } from './home'
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

const shown = (refs: Resolved[]): Shown[] => refs.map(({ ref, status, files, matches }) => ({ ref, status, files, matches }))

function functionsOf(map: CodeMap): Fn[] {
  return map.folders
    .flatMap((folder) => folder.files)
    .flatMap((file) => file.functions.map((fn) => ({ file: file.path, name: fn.name, line: fn.line, test: isTestFile(file.path) })))
}

function distinct(refs: Resolved[]): Resolved[] {
  const seen = new Set<string>()
  return refs.filter(counted).filter((ref) => {
    const key = `${ref.files.join('\0')}|${ref.fns.join(',')}`
    return !seen.has(key) && Boolean(seen.add(key))
  })
}

function stubOf(fns: Fn[], input: WhereInput, calls: Resolved[], callers: Resolved[], file: string): string {
  const name = input.name !== undefined && IDENTIFIER.test(input.name) ? input.name : 'proposed'
  const local = [...calls, ...callers].filter((ref) => ref.status === 'function' && ref.files[0] === file)
  const names = [...new Set(local.map((ref) => fns[ref.fns[0] ?? -1]?.name ?? ''))].filter((callee) => IDENTIFIER.test(callee))
  const exported = callers.length === 0 || callers.some((ref) => ref.files.some((other) => other !== file))
  return `${exported ? 'export ' : ''}function ${name}() {\n${names.map((callee) => `  ${callee}()\n`).join('')}}\n`
}

function targetOf(root: string, cwd: string, file: string): string {
  const fromCwd = path.resolve(cwd, file)
  const fromRoot = path.resolve(root, file)
  if (fs.existsSync(fromCwd)) return fromCwd
  if (fs.existsSync(fromRoot)) return fromRoot
  const relative = projectPath(root, cwd, file)
  return relative === '..' || relative.startsWith('../') || path.isAbsolute(relative) ? fromRoot : fromCwd
}

function existing(target: string): string | Error {
  const stat = fs.statSync(target, { throwIfNoEntry: false })
  if (!stat) return ''
  if (!stat.isFile()) return new Error(`${target} is not a file`)
  return fs.readFileSync(target, 'utf8')
}

function fileCheck(ctx: WhereContext, target: string, stub: string): FileCheck {
  const file = projectPath(ctx.root, ctx.root, target)
  const owners = ctx.architecture ? ownership([file], ctx.architecture.components) : null
  const owned = owners ? [...owners.owned.map((entry) => entry.owner), ...owners.multi.flatMap((entry) => entry.owners)] : []
  try {
    const before = existing(target)
    if (before instanceof Error) throw before
    const content = stub === '' ? before : `${before}${before === '' || before.endsWith('\n') ? '' : '\n'}${before === '' ? '' : '\n'}${stub}`
    const { violations } = proposedFile(ctx.root, ctx.architecture?.rules, ctx.architecture?.scope, target, content)
    return { file, owners: owned, fits: violations.length === 0, violations, stub }
  } catch (err) {
    return { file, owners: owned, fits: false, violations: [], stub, error: errorText(err) }
  }
}

function probeIn(root: string, folder: string): string {
  const dir = path.join(root, folder)
  let n = 0
  while (fs.existsSync(path.join(dir, `new${n || ''}.ts`))) n += 1
  return path.join(dir, `new${n || ''}.ts`)
}

function notesOf(ctx: WhereContext, fns: Fn[], input: WhereInput, refs: Resolved[], file: string | null): string[] {
  const stale = ctx.stale === null ? [] : [`architect.md does not parse (${ctx.stale}); components and rules come from the last version that parsed`]
  const missing = ctx.architecture ? [] : ['there is no architect.md; rules are the defaults and no dependency was checked']
  const unmatched = refs.filter((ref) => ref.status === 'none').map((ref) => `${ref.ref} matched no function or file in the scan`)
  const ambiguous = refs.filter((ref) => ref.status === 'ambiguous').map((ref) => `${ref.ref} matched ${ref.matches.length} functions in different files, pass file:name to pick one: ${ref.matches.join(', ')}`)
  const taken = input.name === undefined ? [] : fns.filter((fn) => !fn.test && fn.name === input.name).map((fn) => `a function named ${fn.name} already exists at ${fn.file}:${fn.line}`)
  const whole = refs.filter((ref) => ref.status === 'file' && ref.files[0] === file).map((ref) => `${ref.ref} names the whole proposed file, so the jobs rule treats the new function as unrelated to it; pass file:name to name the function it joins`)
  return [...stale, ...missing, ...unmatched, ...ambiguous, ...taken, ...whole]
}

export function whereOf(input: WhereInput, ctx: WhereContext): Where {
  const fns = functionsOf(ctx.map)
  const calls = resolveRefs(fns, ctx.map, ctx.root, ctx.cwd, input.calls)
  const callers = resolveRefs(fns, ctx.map, ctx.root, ctx.cwd, input.callers)
  const files = ctx.map.folders.flatMap((folder) => folder.files.map((file) => file.path))
  const [wanted, calling] = [distinct(calls), distinct(callers)]
  const { component, folder } = homeOf(ctx.architecture, files, wanted, calling)

  const target = input.file === undefined || input.file.trim() === '' ? null : targetOf(ctx.root, ctx.cwd, input.file.trim())
  const proposed = target === null ? null : projectPath(ctx.root, ctx.root, target)
  return {
    calls: shown(calls),
    callers: shown(callers),
    component,
    folder: { ...folder, newFile: folder.path === null ? null : fileCheck(ctx, probeIn(ctx.root, folder.path), '') },
    verb: verbOf(fns, folder.path, input.name),
    similar: similarOf(fns, edgesOf(ctx.map), wanted, calling),
    file: target === null || proposed === null ? null : fileCheck(ctx, target, stubOf(fns, input, wanted, calling, proposed)),
    notes: notesOf(ctx, fns, input, [...calls, ...callers], proposed),
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
