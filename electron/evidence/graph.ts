import type { CallSite, CodeMap, FileStart } from '../../shared/types'
import { edgesOf } from '../functions/facts'

type Node = { name: string; file: string; line?: number }

export type Site = { caller: string; file: string; line?: number }

export type Graph = { mermaid: string | null; shown: number; total: number; callers: number; sites: Site[] }

const MAX_EDGES = 60

const KINDS: Record<FileStart['kind'], string> = {
  load: 'module top level',
  value: 'passed as a value',
  exports: 'export',
  mcpTool: 'MCP tool',
  ipcHandler: 'IPC handler',
  bridge: 'bridge',
  cliCommand: 'CLI command',
}

const labelOf = (start: FileStart) => [KINDS[start.kind], start.channel ?? start.member].filter(Boolean).join(' ')

const escaped = (text: string) => text.replace(/#/g, '#35;').replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;')

function mermaidOf(nodes: Node[], edges: [number, number][]): string {
  const label = (node: Node) => `"${escaped(node.name)}<br/>${escaped(node.line === undefined ? node.file : `${node.file}:${node.line}`)}"`
  const shapes = nodes.map((node, i) => (i === 0 ? `  n0([${label(node)}])` : `  n${i}[${label(node)}]`))
  const arrows = edges.map(([from, to]) => `  n${from} --> n${to}`)
  return ['```mermaid', 'flowchart LR', ...shapes, ...arrows, '```'].join('\n')
}

export function graphOf(map: CodeMap, file: string, fn: number, depth: number): Graph {
  const files = map.folders.flatMap((folder) => folder.files)
  const offset = new Map<string, number>()
  const nodes: Node[] = []
  for (const entry of files) {
    if (!offset.has(entry.path)) offset.set(entry.path, nodes.length)
    nodes.push(...entry.functions.map((one) => ({ name: one.name, file: entry.path, line: one.line })))
  }
  const indexOf = (site: { file: string; fn: number }) => {
    const at = offset.get(site.file)
    return at === undefined || nodes[at + site.fn]?.file !== site.file ? undefined : at + site.fn
  }

  const out = edgesOf(map)
  const into = nodes.map((): number[] => [])
  out.forEach((callees, from) => callees.forEach((to) => into[to]?.push(from)))
  const sitesOf: CallSite[][] = files.flatMap((entry) => entry.functions.map((one) => one.sites ?? []))
  for (const entry of files) {
    for (const start of entry.starts ?? []) {
      if (start.kind === 'exports') continue
      const at = nodes.push({ name: labelOf(start), file: entry.path, ...(start.line === undefined ? {} : { line: start.line }) }) - 1
      sitesOf[at] = start.sites ?? []
      for (const call of start.calls) {
        const to = indexOf(call)
        if (to !== undefined) into[to]?.push(at)
      }
    }
  }

  const target = indexOf({ file, fn })
  if (target === undefined) return { mermaid: null, shown: 0, total: 0, callers: 0, sites: [] }

  const walk = (next: (node: number) => number[], pair: (node: number, other: number) => [number, number]) => {
    const seen = new Set([target])
    const found: { edge: [number, number]; level: number }[] = []
    let frontier = [target]
    for (let level = 1; level <= depth && frontier.length > 0; level += 1) {
      const reached: number[] = []
      for (const node of frontier) {
        for (const other of new Set(next(node))) {
          found.push({ edge: pair(node, other), level })
          if (!seen.has(other)) reached.push(other)
          seen.add(other)
        }
      }
      frontier = reached
    }
    return found
  }
  const up = walk((node) => into[node] ?? [], (node, caller) => [caller, node])
  const down = walk((node) => out[node] ?? [], (node, callee) => [node, callee])
  const all = [...up, ...down].sort((a, b) => a.level - b.level)
  const kept = all.slice(0, MAX_EDGES).map((found) => found.edge)

  const direct = [...new Set(into[target] ?? [])]
  const sites = direct.flatMap((caller): Site[] => {
    const node = nodes[caller]
    if (!node) return []
    const lines = (sitesOf[caller] ?? []).flatMap((site) => ('fn' in site && indexOf(site) === target ? [site.line] : []))
    const unique = [...new Set(lines)].sort((a, b) => a - b)
    if (unique.length === 0) return [{ caller: node.name, file: node.file, ...(node.line === undefined ? {} : { line: node.line }) }]
    return unique.map((line) => ({ caller: node.name, file: node.file, line }))
  })

  const local = new Map([...new Set([target, ...kept.flat()])].map((node, i) => [node, i]))
  const drawn = [...local.keys()].flatMap((node) => nodes[node] ?? [])
  const edges = kept.map(([from, to]): [number, number] => [local.get(from) ?? 0, local.get(to) ?? 0])
  return { mermaid: edges.length === 0 ? null : mermaidOf(drawn, edges), shown: edges.length, total: all.length, callers: direct.length, sites }
}
