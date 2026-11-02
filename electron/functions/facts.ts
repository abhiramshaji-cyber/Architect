import type { CodeMap, FunctionFacts } from '../../shared/types'

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

const fnKey = (file: string, index: number) => `${file}\0${index}`

export function factsOf(map: CodeMap, declared: Set<string>): FunctionFacts[] {
  const files = map.folders.flatMap((folder) => folder.files)
  const loaded = new Set(files.flatMap((file) => file.imports ?? []))

  const callers = new Map<string, number>()
  for (const file of files) {
    file.functions.forEach((fn, index) => {
      const self = fnKey(file.path, index)
      for (const target of new Set(fn.calls.map((call) => fnKey(call.file, call.fn)))) {
        if (target !== self) callers.set(target, (callers.get(target) ?? 0) + 1)
      }
    })
  }

  return files.flatMap((file) => {
    const entry = declared.has(file.path) || !loaded.has(file.path)
    return file.functions.map((fn, index) => {
      const self = fnKey(file.path, index)
      const callees = new Set(fn.calls.map((call) => fnKey(call.file, call.fn)))
      callees.delete(self)
      return {
        file: file.path,
        name: fn.name,
        line: fn.line,
        lines: Math.max(1, fn.endLine - fn.line + 1),
        fanIn: callers.get(self) ?? 0,
        fanOut: callees.size,
        exported: fn.exported === true,
        entry,
      }
    })
  })
}
