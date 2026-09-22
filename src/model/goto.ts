import type { CallRef, CodeMap } from '../../shared/types'
import { fileIndex } from './codemap'

export type SymbolRef = { file: string; index: number }

export type Located = SymbolRef & { name: string; line: number; endLine: number }

export type GotoResult =
  | { status: 'no-map' }
  | { status: 'unresolved' }
  | { status: 'found'; def: Located; callers: Located[]; callees: Located[] }

function asRef(call: CallRef): SymbolRef {
  return { file: call.file, index: call.fn }
}

function same(a: SymbolRef, b: SymbolRef): boolean {
  return a.file === b.file && a.index === b.index
}

function locate(index: ReturnType<typeof fileIndex>, ref: SymbolRef): Located | undefined {
  const fn = index.get(ref.file)?.functions[ref.index]
  return fn && { file: ref.file, index: ref.index, name: fn.name, line: fn.line, endLine: fn.endLine }
}

function dedupe(refs: Located[]): Located[] {
  return [...new Map(refs.map((ref) => [`${ref.file}#${ref.index}`, ref])).values()]
}

export function gotoSymbol(map: CodeMap | null | undefined, ref: SymbolRef): GotoResult {
  if (!map) return { status: 'no-map' }

  const index = fileIndex(map)
  const def = locate(index, ref)
  if (!def) return { status: 'unresolved' }

  const callees = dedupe(
    (index.get(ref.file)?.functions[ref.index]?.calls ?? [])
      .map(asRef)
      .filter((call) => !same(call, ref))
      .flatMap((call) => locate(index, call) ?? [])
  )

  const callers = dedupe(
    map.folders
      .flatMap((folder) => folder.files)
      .flatMap((file) =>
        file.functions
          .map((fn, i) => ({ file: file.path, index: i, name: fn.name, line: fn.line, endLine: fn.endLine, calls: fn.calls }))
          .filter((caller) => !same(caller, ref) && caller.calls.some((call) => same(asRef(call), ref)))
      )
  )

  return { status: 'found', def, callers, callees }
}
