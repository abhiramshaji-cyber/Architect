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
import { importersOf, testsOf } from './tests'
import { changesOf, keysOf, type Outside } from './touched'

export { impactSchema, type Impact } from './schema'

export type ImpactInput = { cwd: string; from?: string; to?: string; file?: string; content?: string }

type Spot = { file: string; line: number; name: string }

type Seeded = { seeds: number[]; touched: Touch[]; added: Spot[]; edited?: Spot; whole?: string; users?: number[]; file: string | null; notes: string[] }

const SETTLE_MS = 2000

const CODE = /\.[cm]?[jt]sx?$/i

const NAMED = 5

const NOTES = 20

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

const capped = (notes: string[]) => (notes.length > NOTES ? [...notes.slice(0, NOTES - 1), `${notes.length - NOTES + 1} more notes are left out`] : notes)

function firstDiff(before: string, after: string): number {
  const [a, b] = [before.split(/\r?\n/), after.split(/\r?\n/)]
  const at = a.findIndex((line, i) => line !== b[i])
  return (at < 0 ? Math.min(a.length, b.length) : at) + 1
}

function fileSeeds(input: ImpactInput & { file: string; content: string }, root: string, files: FileEntry[], fns: Fn[]): Seeded {
  const file = projectPath(root, input.cwd, input.file)
  if (file === '' || file === '..' || file.startsWith('../') || path.isAbsolute(file)) return { seeds: [], touched: [], added: [], file: null, notes: [`${input.file} is outside ${root}, so no function is touched`] }
  const current = before(root, file)
  if (current instanceof Error) return { seeds: [], touched: [], added: [], file, notes: [`${file} could not be read (${current.message}), so no function is touched`] }

  const { changes, parsed, outside, uses } = changesOf(file, current, input.content)
  const same = current.replaceAll('\r\n', '\n') === input.content.replaceAll('\r\n', '\n')
  const code = CODE.test(file)
  const notes = same ? [`the proposed content of ${file} is the same as the file on disk, so no function is touched`] : parsed === 0 && !code ? [`${file} holds no function the scan parses, so no function is touched`] : []
  const offset = fns.findIndex((fn) => fn.file === file)
  const scanned = keysOf(files.find((entry) => entry.path === file)?.functions ?? [])
  const moved = outside === 'all' || outside.code || outside.names.length > 0 || outside.locals.length > 0
  const wide = !same && code && moved && fs.existsSync(path.join(root, file)) ? outsideSeeds(root, file, outside, uses, scanned, offset, files, fns) : null
  if (wide) notes.push(wide.note)
  if (!same && code && !moved && changes.length === 0) notes.push(`the change to ${file} only touches formatting, quotes or comments, so nothing is counted`)

  const sharing = changes.filter((change) => change.change === 'changed' && change.shares.length > 0)
  if (sharing.length > 0) notes.push(`${sharing.length} changed functions share a line with another function (${listed(sharing.map((change) => `${change.name} at ${file}:${change.line}`))}); the scan gives lines, not columns, so an edit on that line counts as a change to each`)
  const unseen: string[] = []
  const seeds = changes.flatMap((change) => {
    if (change.change === 'added') return []
    const base = change.key.slice(0, change.key.lastIndexOf('#') + 1)
    const matches = scanned.flatMap((key, index) => (key.startsWith(base) && !key.slice(base.length).includes('/') ? [index] : []))
    if (matches.length > 0 && offset >= 0) return matches.map((index) => offset + index)
    unseen.push(`${change.name} at ${file}:${change.line}`)
    return []
  })
  if (unseen.length > 0) notes.push(`${unseen.length} changed functions are not in the scan (${listed(unseen)}); the scan skips this path or the file changed after the scan, so their callers are not counted`)
  const touched = changes.map((change) => ({ name: change.name, change: change.change, at: `${file}:${change.line}`, in: change.change === 'added' ? ('proposed' as const) : ('disk' as const) }))
  const added = changes.filter((change) => change.change === 'added').map((change) => ({ file, line: change.line, name: change.name }))
  return { seeds: [...new Set([...seeds, ...(wide?.seeds ?? [])])], ...(same ? {} : { edited: { file, line: firstDiff(current, input.content), name: '' } }), touched, added, file, notes, ...(wide && wide.users.length > 0 ? { whole: file, users: wide.users } : {}) }
}

const listed = (names: string[]) => names.slice(0, NAMED).join(', ') + (names.length > NAMED ? ', ...' : '')

function outsideSeeds(root: string, file: string, outside: Outside, uses: (names: string[]) => string[], scanned: string[], offset: number, files: FileEntry[], fns: Fn[]): { seeds: number[]; users: number[]; note: string } {
  const all = outside === 'all'
  const changed = all ? [] : [...outside.names, ...outside.locals]
  const keys = new Set(all ? scanned : uses(changed))
  const own = offset < 0 ? [] : scanned.flatMap((key, index) => (keys.has(key) ? [offset + index] : []))
  const loads = all || outside.code
  const importers = loads || outside.names.length > 0 ? importersOf(root, file, loads ? 'all' : outside.names, files) : new Set<string>()
  const using = fns.flatMap((fn, i) => (importers.has(fn.file) ? [i] : []))
  const what = [...(all ? ['a module load or a star re-export'] : []), ...(!all && outside.code ? ['code that runs when the file loads, such as a handler it registers'] : []), ...(changed.length > 0 ? [listed(changed)] : [])].join('; ')
  const note = `code outside every function in ${file} changed (${what}), so its ${own.length} functions ${all ? 'all count' : 'that use those names count'} as touched, and the ${using.length} functions in the ${importers.size} files that ${loads ? 'load it' : 'import those names'}, directly or through a re-export, count as its callers`
  return { seeds: own, users: using, note }
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
  const hits = [...[...reach.depth.keys()].flatMap((node) => (fns[node] && (!fns[node].test || reach.depth.get(node) === 0) ? [{ ...fns[node], entry: false }] : [])), ...added.map((spot) => ({ ...spot, entry: false })), ...entries.map((entry) => ({ file: entry.file, line: 0, entry: true }))]
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

  const { reach, callers, entries, reached, notes } = callersOf(fns, files, edgesOf(map), seeded.seeds, seeded.whole && seeded.users ? { file: seeded.whole, users: seeded.users } : undefined)
  const tests = testsOf(root, fns, files, reach, seeded.added, seeded.edited, seeded.whole)
  return {
    status: 'done',
    touched: { total: seeded.touched.length, listed: seeded.touched.slice(0, LISTED) },
    callers,
    entries,
    components: componentsOf(architecture, fns, reach, seeded.added, reached),
    tests: { total: tests.total, listed: tests.listed },
    notes: capped([...both, ...seeded.notes, ...(seeded.touched.length > LISTED ? [`${seeded.touched.length - LISTED} touched functions are counted but not listed`] : []), ...notes, ...tests.notes]),
  }
}

function current(root: string, map: CodeMap): boolean {
  const paths = [...map.folders.map((folder) => folder.path), ...map.folders.flatMap((folder) => folder.files.map((file) => file.path)).filter((file) => CODE.test(file))]
  const settled = (stat: fs.Stats | undefined) => stat !== undefined && stat.ctimeMs < map.scannedAt - SETTLE_MS
  const manifests = ['package.json', 'tsconfig.json'].map((name) => fs.statSync(path.join(root, name), { throwIfNoEntry: false }))
  return manifests.every((stat) => stat === undefined || settled(stat)) && paths.every((entry) => settled(fs.statSync(path.join(root, entry), { throwIfNoEntry: false })))
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

export async function impactFor(input: ImpactInput, root: string, architecture: Architecture, stale: string | null = null, timeoutMs = TIMEOUT_MS): Promise<Impact> {
  const empty = { total: 0, listed: [] }
  const failed = (status: 'timeout' | 'failed', note: string): Impact => ({ status, touched: empty, callers: { ...empty, depths: [], listedThrough: LIST_DEPTH, unlisted: 0 }, entries: empty, components: [], tests: empty, notes: [note] })
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(resolve, timeoutMs, null)
  })
  try {
    const map = await Promise.race([mapOf(root), late])
    if (map === null) return failed('timeout', `impact was not worked out: scanning ${root} took longer than ${timeoutMs} ms; the scan goes on and a later check uses it`)
    const impact = impactOf(input, root, architecture, map)
    return stale === null ? impact : { ...impact, notes: capped([`architect.md does not parse (${stale}); components come from the last version that parsed`, ...impact.notes]) }
  } catch (err) {
    return failed('failed', `impact could not be worked out: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timer)
  }
}
