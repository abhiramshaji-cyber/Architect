import dagre from '@dagrejs/dagre'
import type { CodeMap, FileEntry, FolderEntry, FunctionEntry, Pt } from '../shared/types'
import { NODE_W } from './layout'

export const FUNCTIONS_SHOWN = 8
export const FOLDER_H = 56
export const FILE_BASE_H = 46
export const FN_ROW_H = 30
export const FILE_NOTE_H = 20

export const FN_NODE_W = 240
export const FN_BASE_H = 44
export const FN_DESC_H = 30

export type Counts = { files: number; functions: number }

export type FnRef = { index: number; name: string }

export type CodeNodeData =
  | { kind: 'folder'; name: string; path: string; counts: Counts }
  | { kind: 'codefile'; name: string; path: string; functions: FunctionEntry[] }
  | {
      kind: 'codefn'
      name: string
      path: string
      line: number
      endLine: number
      description: string
      calls: FnRef[]
      callers: FnRef[]
    }

export type CodeNode = { id: string; data: CodeNodeData; height: number }

export type CodeLink = { id: string; source: string; target: string }

export type Crumb = { label: string; path: string }

export function baseName(path: string): string {
  const segments = path.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? path
}

export function parentOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? '' : path.slice(0, cut)
}

export function folderIndex(map: CodeMap): Map<string, FolderEntry> {
  return new Map(map.folders.map((f) => [f.path, f]))
}

export function subtreeCounts(index: Map<string, FolderEntry>, path: string): Counts {
  const queue = [path]
  const seen = new Set(queue)
  let files = 0
  let functions = 0

  while (queue.length > 0) {
    const entry = index.get(queue.shift() as string)
    if (!entry) continue
    for (const file of entry.files) {
      files += 1
      functions += file.functions.length
    }
    for (const child of entry.folders) {
      if (seen.has(child)) continue
      seen.add(child)
      queue.push(child)
    }
  }

  return { files, functions }
}

export function fileIndex(map: CodeMap): Map<string, FileEntry> {
  return new Map(map.folders.flatMap((f) => f.files.map((file) => [file.path, file] as const)))
}

export function hasCode(index: Map<string, FolderEntry>, path: string): boolean {
  return subtreeCounts(index, path).functions > 0
}

export function worldPath(map: CodeMap, path: string): string {
  const file = fileIndex(map).get(path)
  if (file) return file.functions.length > 0 ? path : worldPath(map, parentOf(path))

  const index = folderIndex(map)
  let walked = path
  while (walked !== '' && !hasCode(index, walked)) walked = parentOf(walked)
  return index.has(walked) ? walked : ''
}

export function hangingIndent(line: string): number {
  const lead = line.length - line.trimStart().length
  const width = [...line.slice(0, lead)].reduce((n, c) => n + (c === '\t' ? 2 : 1), 0)
  return width + 2
}

export function heightOf(data: CodeNodeData): number {
  if (data.kind === 'folder') return FOLDER_H

  if (data.kind === 'codefn') return FN_BASE_H + (data.description === '' ? 0 : FN_DESC_H)

  const shown = Math.min(data.functions.length, FUNCTIONS_SHOWN)
  const note = data.functions.length === 0 || data.functions.length > FUNCTIONS_SHOWN ? FILE_NOTE_H : 0
  return FILE_BASE_H + shown * FN_ROW_H + note
}

export function widthOf(data: CodeNodeData): number {
  return data.kind === 'codefn' ? FN_NODE_W : NODE_W
}

export function fnNodeId(path: string, index: number, name: string): string {
  return `codefn:${path}#${index}:${name}`
}

export function functionNodes(file: FileEntry): CodeNode[] {
  const refs = file.functions.map((fn, i) => ({ index: i, name: fn.name }))

  const resolved = file.functions.map((fn, i) =>
    [...new Set(fn.calls)].flatMap((call) => (call === i ? [] : (refs[call] ?? [])))
  )

  const callers = new Map<number, FnRef[]>()
  for (const [i, calls] of resolved.entries()) {
    const from = refs[i]
    if (from === undefined) continue
    for (const call of calls) callers.set(call.index, [...(callers.get(call.index) ?? []), from])
  }

  return file.functions.map((fn, i) => {
    const data: CodeNodeData = {
      kind: 'codefn',
      name: fn.name,
      path: file.path,
      line: fn.line,
      endLine: fn.endLine,
      description: fn.description,
      calls: resolved[i] ?? [],
      callers: callers.get(i) ?? []
    }
    return { id: fnNodeId(file.path, i, fn.name), data, height: heightOf(data) }
  })
}

export function functionEdges(file: FileEntry): CodeLink[] {
  const links: CodeLink[] = []
  const seen = new Set<string>()

  for (const [i, fn] of file.functions.entries()) {
    const source = fnNodeId(file.path, i, fn.name)
    for (const call of fn.calls) {
      const target = file.functions[call]
      if (target === undefined || call === i) continue

      const link = { id: `${source}->${call}`, source, target: fnNodeId(file.path, call, target.name) }
      if (seen.has(link.id)) continue
      seen.add(link.id)
      links.push(link)
    }
  }

  return links
}

export function worldNodes(index: Map<string, FolderEntry>, path: string): CodeNode[] {
  const entry = index.get(path)
  if (!entry) return []

  const folders: CodeNodeData[] = entry.folders
    .filter((child) => hasCode(index, child))
    .map((child) => ({
      kind: 'folder',
      name: baseName(child),
      path: child,
      counts: subtreeCounts(index, child)
    }))

  const files: CodeNodeData[] = entry.files
    .filter((file) => file.functions.length > 0)
    .map((file) => ({
      kind: 'codefile',
      name: baseName(file.path),
      path: file.path,
      functions: file.functions
    }))

  return [...folders, ...files].map((data) => ({ id: `${data.kind}:${data.path}`, data, height: heightOf(data) }))
}

export function crumbs(rootLabel: string, path: string): Crumb[] {
  const trail: Crumb[] = [{ label: rootLabel, path: '' }]
  let walked = ''
  for (const segment of path.split('/').filter(Boolean)) {
    walked = walked === '' ? segment : `${walked}/${segment}`
    trail.push({ label: segment, path: walked })
  }
  return trail
}

export function columnsFor(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(count)))
}

function place(nodes: CodeNode[], links: [string, string][]): Map<string, Pt> {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', ranksep: 44, nodesep: 30, marginx: 40, marginy: 40 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of nodes) g.setNode(n.id, { width: widthOf(n.data), height: n.height })
  for (const [from, to] of links) g.setEdge(from, to)

  dagre.layout(g)

  return new Map(
    nodes.map((n) => {
      const at = g.node(n.id)
      return [n.id, { x: at.x - widthOf(n.data) / 2, y: at.y - n.height / 2 }]
    })
  )
}

export function codePositions(nodes: CodeNode[]): Map<string, Pt> {
  const columns = columnsFor(nodes.length)
  const chain = nodes.flatMap<[string, string]>((n, i) => {
    const above = nodes[i - columns]
    return above ? [[above.id, n.id]] : []
  })
  return place(nodes, chain)
}

export function callPositions(nodes: CodeNode[], links: CodeLink[]): Map<string, Pt> {
  return place(
    nodes,
    links.map((l) => [l.source, l.target])
  )
}
