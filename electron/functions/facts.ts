import { isTestFile } from '../scan/starts'
import type { CodeMap, Entry, EntryReason, FileEntry, FunctionFacts, Untraced } from '../../shared/types'
import type { EntryFiles } from './entries'

export const REASONS: EntryReason[] = [
  'mcpTool',
  'ipcHandler',
  'bridge',
  'cliCommand',
  'electronMain',
  'preload',
  'renderer',
  'page',
  'bin',
  'main',
  'exports',
  'module',
  'script',
]

const HANDLERS = new Set<string>(['mcpTool', 'ipcHandler', 'bridge', 'cliCommand'])

const LIBRARY = new Set<EntryReason>(['main', 'exports', 'module'])

export function edgesOf(map: CodeMap): number[][] {
  const files = map.folders.flatMap((folder) => folder.files)
  const spans = new Map<string, { start: number; count: number }>()
  let start = 0
  for (const file of files) {
    if (!spans.has(file.path)) spans.set(file.path, { start, count: file.functions.length })
    start += file.functions.length
  }

  let self = 0
  return files.flatMap((file) =>
    file.functions.map((fn) => {
      const out = new Set<number>()
      for (const call of fn.calls) {
        const span = spans.get(call.file)
        if (span !== undefined && call.fn >= 0 && call.fn < span.count) out.add(span.start + call.fn)
      }
      out.delete(self)
      self += 1
      return [...out]
    }),
  )
}

function claimsOf(file: FileEntry, reasons: EntryReason[]): { reason: EntryReason; file: string; fn: number }[] {
  const starts = file.starts ?? []
  const handlers = starts.flatMap((start) =>
    HANDLERS.has(start.kind) ? start.calls.map((call) => ({ ...call, reason: start.kind as EntryReason })) : [],
  )
  const loaded = starts.filter((start) => start.kind === 'load').flatMap((start) => start.calls)
  const api = [
    ...file.functions.flatMap((fn, at) => (fn.exported === true ? [{ file: file.path, fn: at }] : [])),
    ...starts.filter((start) => start.kind === 'exports').flatMap((start) => start.calls),
  ]
  const opened = reasons.flatMap((reason) =>
    [...loaded, ...(LIBRARY.has(reason) ? api : [])].map((call) => ({ ...call, reason })),
  )
  return [...handlers, ...opened].map(({ reason, file: target, fn }) => ({ reason, file: target, fn }))
}

export function entriesOf(map: CodeMap, entries: EntryFiles): Map<string, Entry> {
  const best = new Map<string, Entry>()
  const files = map.folders.flatMap((folder) => folder.files).filter((file) => !isTestFile(file.path))
  files.sort((a, b) => a.path.localeCompare(b.path))
  for (const file of files) {
    for (const { reason, file: target, fn } of claimsOf(file, entries.get(file.path) ?? [])) {
      if (isTestFile(target)) continue
      const key = `${target}\0${fn}`
      const held = best.get(key)
      if (held === undefined || REASONS.indexOf(reason) < REASONS.indexOf(held.reason)) {
        best.set(key, { reason, file: file.path })
      }
    }
  }
  return best
}

function untracedOf(files: FileEntry[]): Map<string, Untraced> {
  const marks = new Map<string, Untraced>()
  for (const file of files.filter((one) => !isTestFile(one.path))) {
    for (const { kind, calls } of file.starts ?? []) {
      if (kind !== 'value' && kind !== 'load') continue
      for (const call of calls) if (marks.get(`${call.file}\0${call.fn}`) !== 'value') marks.set(`${call.file}\0${call.fn}`, kind)
    }
  }
  return marks
}

export function factsOf(map: CodeMap, entries: EntryFiles, edges = edgesOf(map)): FunctionFacts[] {
  const files = map.folders.flatMap((folder) => folder.files)
  const claimed = entriesOf(map, entries)
  const untraced = untracedOf(files)
  const callers = new Array<number>(edges.length).fill(0)
  for (const out of edges) for (const to of out) callers[to] = (callers[to] ?? 0) + 1

  let at = 0
  return files.flatMap((file) =>
    file.functions.map((fn, index): FunctionFacts => {
      const self = at++
      const fact: FunctionFacts = {
        file: file.path,
        name: fn.name,
        line: fn.line,
        lines: Math.max(1, fn.endLine - fn.line + 1),
        fanIn: callers[self] ?? 0,
        fanOut: edges[self]?.length ?? 0,
        exported: fn.exported === true,
        entry: claimed.get(`${file.path}\0${index}`) ?? null,
        untraced: untraced.get(`${file.path}\0${index}`) ?? null,
      }
      if (fn.overload) fact.overload = true
      return fact
    }),
  )
}
