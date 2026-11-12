import type { FileEntry } from '../../../shared/types'
import { isTestFile } from '../../scan/starts'
import type { Budget } from '../schema'
import { bare, exportsOf, importsOf, type Whole } from '../tests'

type Loads = ReturnType<typeof importsOf>

export type Uses = string[] | 'all' | 'unresolved'

export function importersOf(root: string, file: string, names: string[] | 'all', files: FileEntry[], budget: Budget): { found: Map<string, Uses>; barrels: Whole[] } {
  const [found, seen, loads] = [new Map<string, Uses>(), new Set<string>([file]), new Map<string, Loads>()]
  const barrels: Whole[] = []
  const queue = [{ target: file, wanted: names }]
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const { target, wanted } = next
    for (const entry of files) {
      if (isTestFile(entry.path) || !(entry.imports ?? []).includes(target)) continue
      if (Date.now() > budget.until) {
        budget.hit = true
        return { found, barrels }
      }
      const loaded = loads.get(entry.path) ?? (loads.set(entry.path, importsOf(root, entry.path, true)).get(entry.path) as Loads)
      const ways = loaded === 'unreadable' ? [] : loaded.filter((way) => way.target === bare(target))
      const hits = ways.length === 0 ? [{ forwards: false, locals: [] as [string, string][] }] : ways.filter((way) => wanted === 'all' || way.names === null || way.names.some((name) => wanted.includes(name)))
      if (hits.length === 0) continue
      const locals = hits.flatMap((hit) => hit.locals.filter(([original]) => original === '*' || wanted === 'all' || wanted.includes(original)).map(([, local]) => local))
      const held = found.get(entry.path) ?? []
      found.set(entry.path, ways.length === 0 || held === 'unresolved' ? 'unresolved' : wanted === 'all' || held === 'all' ? 'all' : [...new Set([...held, ...locals])])
      const passed = exportsOf(root, entry.path).filter((one) => wanted === 'all' || wanted.includes(one.original) || (one.local && locals.includes(one.original)))
      if ((!hits.some((hit) => hit.forwards) && !passed.some((one) => one.local)) || seen.has(entry.path)) continue
      seen.add(entry.path)
      const forwarded: string[] | 'all' = wanted === 'all' ? 'all' : [...new Set([...wanted, ...passed.map((one) => one.exported)])]
      barrels.push({ file: entry.path, names: forwarded })
      queue.push({ target: entry.path, wanted: forwarded })
    }
  }
  return { found, barrels }
}
