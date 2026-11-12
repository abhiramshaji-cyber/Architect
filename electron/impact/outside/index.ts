import fs from 'node:fs'
import path from 'node:path'
import type { FileEntry } from '../../../shared/types'
import type { Fn } from '../../where/refs'
import type { Budget } from '../schema'
import { exportsOf, type Whole } from '../tests'
import { keysOf, usersOf, type Outside } from '../touched'
import { importersOf, type Uses } from './importers'

export const CODE = /\.[cm]?[jt]sx?$/i

const NAMED = 5

export const listed = (names: string[]) => names.slice(0, NAMED).join(', ') + (names.length > NAMED ? ', ...' : '')

export type Context = { root: string; file: string; files: FileEntry[]; fns: Fn[]; scanned: string[]; offset: number; budget: Budget }

function usingIn(ctx: Context, file: string, locals: Uses): number[] {
  const offset = ctx.fns.findIndex((fn) => fn.file === file)
  const scanned = keysOf(ctx.files.find((entry) => entry.path === file)?.functions ?? [])
  if (offset < 0 || locals === 'all' || locals === 'unresolved') return offset < 0 ? [] : scanned.map((_, index) => offset + index)
  if (Date.now() > ctx.budget.until) {
    ctx.budget.hit = true
    return []
  }
  let text = ''
  try {
    text = fs.readFileSync(path.join(ctx.root, file), 'utf8')
  } catch {
    return []
  }
  const keys = new Set(locals.length > 0 ? usersOf(file, text, locals) : [])
  return scanned.flatMap((key, index) => (keys.has(key) ? [offset + index] : []))
}

export function outsideSeeds(ctx: Context, outside: Outside, uses: (names: string[]) => string[]): { seeds: number[]; users: number[]; wholes: Whole[]; note: string } {
  const { root, file, scanned, offset } = ctx
  const all = outside === 'all'
  const changed = all ? [] : [...outside.names, ...outside.locals]
  const keys = new Set(all ? scanned : uses(changed))
  const own = offset < 0 ? [] : scanned.flatMap((key, index) => (keys.has(key) ? [offset + index] : []))
  const loads = all || outside.code
  const passed = all ? [] : exportsOf(root, file).filter((one) => one.local && outside.locals.includes(one.original)).map((one) => one.exported)
  const names: string[] | 'all' = loads ? 'all' : [...new Set([...outside.names, ...passed])]
  const { found, barrels } = names === 'all' || names.length > 0 ? importersOf(root, file, names, ctx.files, ctx.budget) : { found: new Map<string, Uses>(), barrels: [] }
  const per = [...found].map(([path, locals]) => ({ path, locals, users: usingIn(ctx, path, locals) }))
  const using = per.flatMap((one) => one.users)
  const idle = per.filter((one) => one.users.length === 0 && Array.isArray(one.locals) && one.locals.length > 0 && !barrels.some((barrel) => barrel.file === one.path)).map((one) => one.path)
  const unresolved = per.filter((one) => one.locals === 'unresolved').map((one) => one.path)

  const what = [...(all ? [CODE.test(file) ? 'a module load or a star re-export' : 'its content, which code imports'] : []), ...(!all && outside.code ? ['code that runs when the file loads, such as a handler it registers'] : []), ...(changed.length > 0 ? [listed(changed)] : [])].join('; ')
  const loose = unresolved.length > 0 ? `; ${unresolved.length} of those files import it by a path that is not relative (${listed(unresolved)}), so all their functions count` : ''
  const quiet = idle.length > 0 ? `; ${idle.length} of those files name it in no function (${listed(idle)}), so it is used at their top level or loaded another way, and their own importers are not followed` : ''
  const note = `code outside every function in ${file} changed (${what}), so its ${own.length} functions ${all ? 'all count' : 'that use those names count'} as touched, and the ${using.length} functions ${loads ? 'in' : 'that use those names in'} the ${found.size} files that ${loads ? 'load it' : 'import them'}, directly or through a re-export, count as its callers${loose}${quiet}`
  return { seeds: own, users: using, wholes: [{ file, names }, ...barrels], note }
}
