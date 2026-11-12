import fs from 'node:fs'
import path from 'node:path'
import type { Architecture, CodeMap, FileEntry } from '../../shared/types'
import { ownership } from '../contract/graph'
import { edgesOf } from '../functions/facts'
import { scan } from '../scan/scan'
import { isTestFile } from '../scan/starts'
import { projectPath, type Fn } from '../where/refs'
import { callersOf, LIST_DEPTH, LISTED, type Reach } from './callers'
import type { Impact, Touch } from './schema'
import { testsOf } from './tests'
import { changesOf, keysOf } from './touched'

export { impactSchema, type Impact } from './schema'

export type ImpactInput = { cwd: string; from?: string; to?: string; file?: string; content?: string }

type Spot = { file: string; line: number }

type Seeded = { seeds: number[]; touched: Touch[]; added: Spot[]; file: string | null; notes: string[] }

const SETTLE_MS = 2000

const TIMEOUT_MS = 5000

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
  const notes = current.replaceAll('\r\n', '\n') === input.content.replaceAll('\r\n', '\n') ? [`the proposed content of ${file} is the same as the file on disk, so no function is touched`] : parsed === 0 ? [`${file} holds no function the scan parses, so no function is touched`] : changes.length === 0 ? [`the change to ${file} is outside every function, so no function is touched`] : []
  const offset = fns.findIndex((fn) => fn.file === file)
  const scanned = keysOf(files.find((entry) => entry.path === file)?.functions ?? [])
  notes.push(...changes.filter((change) => change.change === 'changed' && change.shares.length > 0).map((change) => `${change.name} at ${file}:${change.line} shares a line with ${change.shares.join(', ')}; the scan gives lines, not columns, so an edit on that line counts as a change to each`))
  const seeds = changes.flatMap((change) => {
    if (change.change === 'added') return []
    const index = scanned.indexOf(change.key)
    if (index >= 0 && offset >= 0) return [offset + index]
    notes.push(`${change.name} at ${file}:${change.line} is not in the last scan, so its callers are not counted`)
    return []
  })
  const touched = changes.map((change) => ({ name: change.name, change: change.change, at: `${file}:${change.line}`, in: change.change === 'added' ? ('proposed' as const) : ('disk' as const) }))
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

function componentsOf(architecture: Architecture, fns: Fn[], reach: Reach, added: Spot[], entries: Impact['entries']['listed']): Impact['components'] {
  const hits = [...[...reach.depth.keys()].flatMap((node) => (fns[node] && !fns[node].test ? [{ ...fns[node], entry: false }] : [])), ...added.map((spot) => ({ ...spot, entry: false })), ...entries.map((entry) => ({ file: entry.file, line: 0, entry: true }))]
  hits.sort((a, b) => Number(a.entry) - Number(b.entry) || a.file.localeCompare(b.file) || a.line - b.line)
  const found = ownership([...new Set(hits.map((hit) => hit.file))], architecture.components)
  const owners = new Map<string, string[]>([...found.owned.map((entry): [string, string[]] => [entry.path, [entry.owner]]), ...found.multi.map((entry): [string, string[]] => [entry.path, entry.owners])])

  const byOwner = new Map<string | null, { functions: number; entries: number; first: string }>()
  for (const hit of hits) {
    for (const id of owners.get(hit.file) ?? [null]) {
      const held = byOwner.get(id) ?? { functions: 0, entries: 0, first: hit.entry ? hit.file : `${hit.file}:${hit.line}` }
      byOwner.set(id, { ...held, functions: held.functions + Number(!hit.entry), entries: held.entries + Number(hit.entry) })
    }
  }
  const weight = (held: { functions: number; entries: number }) => held.functions + held.entries
  return [...byOwner].map(([id, held]) => ({ id, ...held })).sort((a, b) => weight(b) - weight(a) || Number(a.id === null) - Number(b.id === null) || (a.id ?? '').localeCompare(b.id ?? ''))
}

export function impactOf(input: ImpactInput, root: string, architecture: Architecture, map: CodeMap): Impact {
  const files = map.folders.flatMap((folder) => folder.files)
  const fns: Fn[] = files.flatMap((file) => file.functions.map((fn) => ({ file: file.path, name: fn.name, line: fn.line, test: isTestFile(file.path) })))
  const { file, content, from, to } = input
  const seeded = file !== undefined && content !== undefined ? fileSeeds({ ...input, file, content }, root, files, fns) : edgeSeeds(from ?? '', to ?? '', architecture, fns)
  const both = file !== undefined && content !== undefined && from !== undefined && to !== undefined ? [`impact is worked out from ${file}; the edge ${from} -> ${to} is answered by the verdict only`] : []

  const { reach, callers, entries, reached, notes } = callersOf(fns, files, edgesOf(map), seeded.seeds)
  const tests = testsOf(root, fns, files, reach, seeded.added[0])
  return {
    touched: { total: seeded.touched.length, listed: seeded.touched.slice(0, LISTED) },
    callers,
    entries,
    components: componentsOf(architecture, fns, reach, seeded.added, reached),
    tests: { total: tests.total, listed: tests.listed },
    notes: [...both, ...seeded.notes, ...(seeded.touched.length > LISTED ? [`${seeded.touched.length - LISTED} touched functions are counted but not listed`] : []), ...notes, ...tests.notes],
  }
}

function current(root: string, map: CodeMap): boolean {
  const paths = [...map.folders.map((folder) => folder.path), ...map.folders.flatMap((folder) => folder.files.map((file) => file.path))]
  return paths.every((entry) => {
    const stat = fs.statSync(path.join(root, entry), { throwIfNoEntry: false })
    return stat !== undefined && stat.ctimeMs < map.scannedAt - SETTLE_MS
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

export async function impactFor(input: ImpactInput, root: string, architecture: Architecture, timeoutMs = TIMEOUT_MS): Promise<Impact> {
  const empty = { total: 0, listed: [] }
  const failed = (note: string): Impact => ({ touched: empty, callers: { ...empty, depths: [], listedThrough: LIST_DEPTH, unlisted: 0 }, entries: empty, components: [], tests: empty, notes: [note] })
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(resolve, timeoutMs, null)
  })
  try {
    const map = await Promise.race([mapOf(root), late])
    if (map === null) return failed(`impact was not worked out: scanning ${root} took longer than ${timeoutMs} ms; the scan goes on and a later check uses it`)
    return impactOf(input, root, architecture, map)
  } catch (err) {
    return failed(`impact could not be worked out: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timer)
  }
}
