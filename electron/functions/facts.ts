import type { CodeMap, FunctionFacts } from '../../shared/types'

const TEST_FILE = /(^|\/)(__tests__|__mocks__)\/|\.(test|spec)\.[cm]?[jt]sx?$/

function relativeEntry(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/^\.\//, '')
  return trimmed === '' ? null : trimmed
}

export function declaredEntries(manifest: unknown): Set<string> {
  if (typeof manifest !== 'object' || manifest === null) return new Set()
  const { main, bin } = manifest as { main?: unknown; bin?: unknown }
  const bins = typeof bin === 'object' && bin !== null ? Object.values(bin) : [bin]
  return new Set([main, ...bins].map(relativeEntry).filter((entry) => entry !== null))
}

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

export function factsOf(map: CodeMap, declared: Set<string>, edges = edgesOf(map)): FunctionFacts[] {
  const files = map.folders.flatMap((folder) => folder.files)
  const loaded = new Set(files.flatMap((file) => file.imports ?? []))
  const callers = new Array<number>(edges.length).fill(0)
  for (const out of edges) for (const to of out) callers[to] = (callers[to] ?? 0) + 1

  let at = 0
  return files.flatMap((file) => {
    const entry = declared.has(file.path) || (!loaded.has(file.path) && !TEST_FILE.test(file.path))
    return file.functions.map((fn) => {
      const self = at++
      return {
        file: file.path,
        name: fn.name,
        line: fn.line,
        lines: Math.max(1, fn.endLine - fn.line + 1),
        fanIn: callers[self] ?? 0,
        fanOut: edges[self]?.length ?? 0,
        exported: fn.exported === true,
        entry,
      }
    })
  })
}
