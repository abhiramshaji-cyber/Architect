import fs from 'node:fs'
import path from 'node:path'
import type { CodeMap, FileEntry, Request } from '../../shared/types'
import { projectPath } from '../where/refs'
import { excerptOf, type Range } from './excerpt'
import { graphOf, type Graph } from './graph'
import { linkerFor, type Linker } from './permalink'

export type EvidenceInput = Omit<Extract<Request, { op: 'evidence' }>, 'id' | 'op'>

type Target = { name: string | null; fn: number | null; range: Range }

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

const placeOf = (site: Graph['sites'][number]) => (site.line === undefined ? site.file : `${site.file}:${site.line}`)

function located(root: string, cwd: string, file: string): { abs: string; rel: string } {
  const abs = [path.resolve(root, file), path.resolve(cwd, file)].find((candidate) => fs.statSync(candidate, { throwIfNoEntry: false })?.isFile())
  if (abs === undefined) throw new Error(`${file} is not a file under ${root}`)
  const rel = projectPath(root, root, abs)
  if (rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) throw new Error(`${file} is outside the project ${root}`)
  return { abs, rel }
}

function bySymbol(entry: FileEntry | undefined, rel: string, symbol: string): Target {
  const fns = (entry?.functions ?? []).map((fn, at) => ({ fn, at })).filter(({ fn }) => fn.twin !== true)
  if (fns.length === 0) throw new Error(`no functions were found in ${rel}, so ${symbol} cannot be located; pass lines instead`)
  const exact = fns.filter(({ fn }) => fn.name === symbol)
  const hits = exact.length > 0 ? exact : fns.filter(({ fn }) => fn.name.endsWith(`.${symbol}`))
  if (hits.length === 0) throw new Error(`no function named ${symbol} in ${rel}; its functions are ${fns.map(({ fn }) => fn.name).join(', ')}`)
  if (hits.length > 1) throw new Error(`${symbol} matches ${hits.length} functions in ${rel}, pass the full name: ${hits.map(({ fn }) => `${fn.name} at line ${fn.line}`).join(', ')}`)
  const [{ fn, at }] = hits as [(typeof hits)[number]]
  return { name: fn.name, fn: at, range: { start: fn.line, end: fn.endLine } }
}

function byLines(entry: FileEntry | undefined, range: Range): Target {
  const around = (entry?.functions ?? [])
    .map((fn, at) => ({ fn, at }))
    .filter(({ fn }) => fn.twin !== true && fn.line <= range.start && fn.endLine >= range.end)
    .sort((a, b) => a.fn.endLine - a.fn.line - (b.fn.endLine - b.fn.line))[0]
  return { name: around?.fn.name ?? null, fn: around?.at ?? null, range }
}

function permalinkPart(linker: Linker, rel: string, range: Range): string {
  if ('note' in linker) return linker.note
  return linker.link(rel, range.start, range.end) ?? linker.why(rel)
}

function graphPart(graph: Graph): string | null {
  if (graph.mermaid === null) return null
  return graph.total > graph.shown ? `${graph.mermaid}\n\nShowing the ${graph.shown} nearest of ${graph.total} call edges.` : graph.mermaid
}

function callersPart(graph: Graph, linker: Linker): string | null {
  if (graph.callers === 0) return null
  const place = (site: Graph['sites'][number]) => {
    const link = 'note' in linker || site.line === undefined ? null : linker.link(site.file, site.line, site.line)
    return link === null ? placeOf(site) : `[${placeOf(site)}](${link})`
  }
  const list = graph.sites.map((site) => `- \`${site.caller}\` at ${place(site)}`)
  return [`${plural(graph.callers, 'caller')}, ${plural(graph.sites.length, 'call site')}:`, ...list].join('\n')
}

export async function evidenceOf(input: EvidenceInput, root: string, map: CodeMap): Promise<string> {
  if ((input.symbol === undefined) === (input.lines === undefined)) throw new Error('pass either symbol or lines, not both and not neither')
  const depth = input.depth ?? 1
  if (depth < 1) throw new Error('depth must be at least 1')

  const { abs, rel } = located(root, input.cwd, input.file)
  const entry = map.folders.flatMap((folder) => folder.files).find((file) => file.path === rel)
  const target = input.symbol === undefined ? byLines(entry, input.lines as Range) : bySymbol(entry, rel, input.symbol)
  const excerpt = excerptOf(fs.readFileSync(abs, 'utf8'), target.range, input.notes)

  const linker = await linkerFor(root)
  const graph = target.fn === null ? null : graphOf(map, rel, target.fn, depth)
  const { start, end } = target.range
  const heading = `${target.name === null ? '' : `\`${target.name}\` in `}\`${rel}\` ${start === end ? `line ${start}` : `lines ${start}-${end}`}`
  const parts = [heading, permalinkPart(linker, rel, target.range), excerpt, graph && graphPart(graph), graph && callersPart(graph, linker)]
  return parts.filter((part): part is string => typeof part === 'string').join('\n\n')
}
