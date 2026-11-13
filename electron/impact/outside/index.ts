import fs from 'node:fs'
import path from 'node:path'
import type { FileEntry } from '../../../shared/types'
import type { Fn } from '../../where/refs'
import type { Budget } from '../schema'
import { exportsOf, type Whole } from '../tests'
import { derivedOf, keysOf, usersOf, type Outside } from '../touched'
import { importersOf, type Uses } from './importers'

export const CODE = /\.[cm]?[jt]sx?$/i

const NAMED = 5

export const listed = (names: string[]) => names.slice(0, NAMED).join(', ') + (names.length > NAMED ? ', ...' : '')

export type Context = { root: string; file: string; files: FileEntry[]; fns: Fn[]; scanned: string[]; offset: number; budget: Budget }

type Use = { users: number[]; derived: string[] }

function usingIn(ctx: Context, file: string, locals: Uses): Use {
  const offset = ctx.fns.findIndex((fn) => fn.file === file)
  const scanned = keysOf(ctx.files.find((entry) => entry.path === file)?.functions ?? [])
  if (offset < 0 && (locals === 'all' || locals === 'unresolved')) return { users: [], derived: [] }
  if (locals === 'all' || locals === 'unresolved') return { users: scanned.map((_, index) => offset + index), derived: [] }
  let text = ''
  try {
    text = fs.readFileSync(path.join(ctx.root, file), 'utf8')
  } catch {
    return { users: [], derived: [] }
  }
  const derived = locals.length > 0 ? derivedOf(file, text, locals) : []
  const keys = new Set(locals.length > 0 ? usersOf(file, text, [...locals, ...derived]) : [])
  return { users: offset < 0 ? [] : scanned.flatMap((key, index) => (keys.has(key) ? [offset + index] : [])), derived }
}

export function outsideSeeds(ctx: Context, outside: Outside, uses: (names: string[]) => string[]): { seeds: number[]; users: number[]; wholes: Whole[]; note: string } {
  const { root, file, scanned, offset } = ctx
  const all = outside === 'all'
  const changed = all ? [] : [...outside.names, ...outside.locals]
  const keys = new Set(all ? scanned : uses(changed))
  const own = offset < 0 ? [] : scanned.flatMap((key, index) => (keys.has(key) ? [offset + index] : []))
  const loads = all || outside.code
  const passed = all ? [] : exportsOf(root, file).filter((one) => one.local && outside.locals.includes(one.original)).map((one) => one.exported)
  const first: string[] | 'all' = loads ? 'all' : [...new Set([...outside.names, ...passed])]

  const [users, wholes, files, idle, unresolved, seen] = [new Set<number>(), [] as Whole[], new Set<string>(), [] as string[], [] as string[], new Set<string>()]
  const queue: Whole[] = first === 'all' || first.length > 0 ? [{ file, names: first }] : []
  for (let next = queue.shift(); next !== undefined && !ctx.budget.hit; next = queue.shift()) {
    const { found, barrels } = importersOf(root, next.file, next.names, ctx.files, ctx.budget)
    wholes.push(next, ...barrels)
    for (const [importer, locals] of found) {
      files.add(importer)
      if (locals === 'unresolved') unresolved.push(importer)
      const use = usingIn(ctx, importer, locals)
      use.users.forEach((index) => users.add(index))
      const fresh = use.derived.filter((name) => !seen.has(`${importer}\0${name}`))
      fresh.forEach((name) => seen.add(`${importer}\0${name}`))
      if (fresh.length > 0) queue.push({ file: importer, names: fresh })
      else if (use.users.length === 0 && use.derived.length === 0 && Array.isArray(locals) && locals.length > 0 && !barrels.some((barrel) => barrel.file === importer)) idle.push(importer)
    }
  }

  const what = [...(all ? [CODE.test(file) ? 'a module load or a star re-export' : 'its content, which code imports'] : []), ...(!all && outside.code ? ['code that runs when the file loads, such as a handler it registers'] : []), ...(changed.length > 0 ? [listed(changed)] : [])].join('; ')
  const loose = unresolved.length > 0 ? `; ${unresolved.length} of those files import it by a path that is not relative (${listed(unresolved)}), so all their functions count` : ''
  const quiet = idle.length > 0 ? `; ${idle.length} of those files name it in no function or top level value (${listed(idle)}), so it is used in code that runs when the file loads or loaded another way` : ''
  const note = `code outside every function in ${file} changed (${what}), so its ${own.length} functions ${all ? 'all count' : 'that use those names count'} as touched, and the ${users.size} functions ${loads ? 'in' : 'that use those names, or values built from them, in'} the ${files.size} files that ${loads ? 'load it' : 'import them'}, directly or through a re-export, count as its callers${loose}${quiet}`
  return { seeds: own, users: [...users], wholes, note }
}
