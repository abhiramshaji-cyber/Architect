import fs from 'node:fs'
import path from 'node:path'
import type { Architecture, CodeMap, FileEntry } from '../../shared/types'
import { ownership } from '../contract/graph'
import { edgesOf } from '../functions/facts'
import { scan } from '../scan/scan'
import { isTestFile } from '../scan/starts'
import { projectPath, type Fn } from '../where/refs'
import { reachOf, type Reach } from './callers'
import type { Caller, Impact, Touch } from './schema'
import { testsOf } from './tests'
import { changesOf, keysOf } from './touched'

export { impactSchema, type Impact } from './schema'

export type ImpactInput = { cwd: string; from?: string; to?: string; file?: string; content?: string }

type Spot = { file: string; line: number }

type Seeded = { seeds: number[]; touched: Touch[]; added: Spot[]; file: string | null; notes: string[] }

const LIST_DEPTH = 3

const LISTED = 25

const DEPTHS = 25

const at = (fn: Fn) => `${fn.file}:${fn.line}`

const named = (fn: Fn) => `${at(fn)} ${fn.name}`

function before(root: string, file: string): string | Error {
  try {
    const target = path.join(root, file)
    if (!fs.existsSync(target)) return ''
    if (!fs.statSync(target).isFile()) return new Error(`${file} is not a file`)
    return fs.readFileSync(target, 'utf8')
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err))
  }
}

function fileSeeds(input: ImpactInput & { file: string; content: string }, root: string, files: FileEntry[], fns: Fn[]): Seeded {
  const file = projectPath(root, input.cwd, input.file)
  if (file === '' || file === '..' || file.startsWith('../') || path.isAbsolute(file)) return { seeds: [], touched: [], added: [], file: null, notes: [`${input.file} is outside ${root}, so no function is touched`] }
  const current = before(root, file)
  if (current instanceof Error) return { seeds: [], touched: [], added: [], file, notes: [`${file} could not be read (${current.message}), so no function is touched`] }

  const { changes, parsed } = changesOf(file, current, input.content)
  const notes = current === input.content ? [`the proposed content of ${file} is the same as the file on disk, so no function is touched`] : parsed === 0 ? [`${file} holds no function the scan parses, so no function is touched`] : changes.length === 0 ? [`the change to ${file} is outside every function, so no function is touched`] : []
  const offset = fns.findIndex((fn) => fn.file === file)
  const scanned = keysOf(files.find((entry) => entry.path === file)?.functions ?? [])
  const seeds = changes.flatMap((change) => {
    if (change.change === 'added') return []
    const index = scanned.indexOf(change.key)
    if (index >= 0 && offset >= 0) return [offset + index]
    notes.push(`${change.name} at ${file}:${change.line} is not in the last scan, so its callers are not counted`)
    return []
  })
  const touched = changes.map((change) => ({ name: change.name, change: change.change, at: `${file}:${change.line}` }))
  return { seeds, touched, added: changes.filter((change) => change.change === 'added').map((change) => ({ file, line: change.line })), file, notes }
}

function edgeSeeds(from: string, to: string, architecture: Architecture, fns: Fn[]): Seeded {
  const paths = [...new Set(fns.map((fn) => fn.file))]
  const found = ownership(paths, architecture.components)
  const owned = new Set([...found.owned.filter((entry) => entry.owner === from).map((entry) => entry.path), ...found.multi.filter((entry) => entry.owners.includes(from)).map((entry) => entry.path)])
  const seeds = fns.flatMap((fn, i) => (!fn.test && owned.has(fn.file) ? [i] : []))
  const note = seeds.length === 0 ? `${from} owns no scanned function, so nothing reaches the new dependency on ${to}` : `an edge changes no function by itself; callers are those of the ${seeds.length} functions ${from} owns, the code that would come to depend on ${to}`
  return { seeds, touched: [], added: [], file: null, notes: [note] }
}

function callersOf(fns: Fn[], reach: Reach): Impact['callers'] & { notes: string[] } {
  const found = [...reach.depth].flatMap(([node, depth]) => {
    const fn = fns[node]
    return fn && !fn.test && depth > 0 ? [{ fn, depth, node }] : []
  })
  found.sort((a, b) => a.depth - b.depth || a.fn.file.localeCompare(b.fn.file) || a.fn.line - b.fn.line)

  const depths: Impact['callers']['depths'] = []
  for (const { fn, depth } of found) {
    const last = depths.at(-1)
    if (last?.depth === depth) last.count += 1
    else depths.push({ depth, count: 1, first: named(fn) })
  }

  const listed = found.filter((hit) => hit.depth <= LIST_DEPTH).slice(0, LISTED).map(({ fn, depth, node }): Caller => {
    const callee = fns[reach.parent.get(node) ?? -1]
    return { name: fn.name, at: at(fn), depth, calls: callee ? named(callee) : '' }
  })
  const notes = [
    ...(found.length > listed.length ? [`${found.length - listed.length} of ${found.length} callers are counted in depths but not listed; the list stops at depth ${LIST_DEPTH} or ${LISTED} callers`] : []),
    ...(depths.length > DEPTHS ? [`callers reach depth ${depths.length}; depths past ${DEPTHS} are counted in total but not shown`] : []),
  ]
  return { total: found.length, depths: depths.slice(0, DEPTHS), listedThrough: LIST_DEPTH, listed, unlisted: found.length - listed.length, notes }
}

function componentsOf(architecture: Architecture, fns: Fn[], reach: Reach, added: Spot[]): Impact['components'] {
  const hits = [...[...reach.depth.keys()].flatMap((node) => (fns[node] && !fns[node].test ? [fns[node]] : [])), ...added]
  hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  const found = ownership([...new Set(hits.map((hit) => hit.file))], architecture.components)
  const owners = new Map<string, string[]>([...found.owned.map((entry): [string, string[]] => [entry.path, [entry.owner]]), ...found.multi.map((entry): [string, string[]] => [entry.path, entry.owners])])

  const byOwner = new Map<string | null, { functions: number; first: string }>()
  for (const hit of hits) {
    for (const id of owners.get(hit.file) ?? [null]) {
      const held = byOwner.get(id)
      byOwner.set(id, { functions: (held?.functions ?? 0) + 1, first: held?.first ?? `${hit.file}:${hit.line}` })
    }
  }
  return [...byOwner].map(([id, held]) => ({ id, ...held })).sort((a, b) => b.functions - a.functions || Number(a.id === null) - Number(b.id === null) || (a.id ?? '').localeCompare(b.id ?? ''))
}

export function impactOf(input: ImpactInput, root: string, architecture: Architecture, map: CodeMap): Impact {
  const files = map.folders.flatMap((folder) => folder.files)
  const fns: Fn[] = files.flatMap((file) => file.functions.map((fn) => ({ file: file.path, name: fn.name, line: fn.line, test: isTestFile(file.path) })))
  const { file, content, from, to } = input
  const seeded = file !== undefined && content !== undefined ? fileSeeds({ ...input, file, content }, root, files, fns) : edgeSeeds(from ?? '', to ?? '', architecture, fns)
  const both = file !== undefined && content !== undefined && from !== undefined && to !== undefined ? [`impact is worked out from ${file}; the edge ${from} -> ${to} is answered by the verdict only`] : []

  const reach = reachOf(edgesOf(map), seeded.seeds)
  const { notes, ...callers } = callersOf(fns, reach)
  const tests = testsOf(root, fns, files, reach, seeded.added[0])
  return {
    touched: { total: seeded.touched.length, listed: seeded.touched.slice(0, LISTED) },
    callers,
    components: componentsOf(architecture, fns, reach, seeded.added),
    tests: { total: tests.total, listed: tests.listed },
    notes: [...both, ...seeded.notes, ...(seeded.touched.length > LISTED ? [`${seeded.touched.length - LISTED} touched functions are counted but not listed`] : []), ...notes, ...tests.notes],
  }
}

function current(root: string, map: CodeMap): boolean {
  const paths = [...map.folders.map((folder) => folder.path), ...map.folders.flatMap((folder) => folder.files.map((file) => file.path))]
  return paths.every((entry) => {
    const stat = fs.statSync(path.join(root, entry), { throwIfNoEntry: false })
    return stat !== undefined && stat.mtimeMs < map.scannedAt
  })
}

const scans = new Map<string, Promise<CodeMap>>()

async function mapOf(root: string): Promise<CodeMap> {
  const held = scans.get(root)
  const last = held ? await held.catch(() => null) : null
  if (last && current(root, last)) return last
  if (scans.get(root) === held) {
    const started = Date.now()
    scans.set(root, scan(root).then((map) => ({ ...map, scannedAt: started })))
  }
  return scans.get(root) as Promise<CodeMap>
}

export async function impactFor(input: ImpactInput, root: string, architecture: Architecture): Promise<Impact> {
  try {
    return impactOf(input, root, architecture, await mapOf(root))
  } catch (err) {
    const empty = { total: 0, listed: [] }
    return { touched: empty, callers: { ...empty, depths: [], listedThrough: LIST_DEPTH, unlisted: 0 }, components: [], tests: empty, notes: [`impact could not be worked out: ${err instanceof Error ? err.message : String(err)}`] }
  }
}
