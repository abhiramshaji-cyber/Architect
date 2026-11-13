import fs from 'node:fs'
import path from 'node:path'
import type { CodeMap, FileEntry, Request } from '../../shared/types'
import { projectPath } from '../where/refs'
import { excerptOf, type Range } from './excerpt'
import { graphOf, type Graph } from './graph'
import { linkerFor, type Linker } from './permalink'

export type EvidenceInput = Omit<Extract<Request, { op: 'evidence' }>, 'id' | 'op'>

type Fn = { at: number; name: string; range: Range }

type Target = { heading: string; fn: number | null; range: Range }

const span = (range: Range) => range.end - range.start

const holds = (outer: Range, inner: Range) => outer.start <= inner.start && outer.end >= inner.end

const inside = (inner: { at: number; range: Range }, outer: { at: number; range: Range }) =>
  inner.at !== outer.at && holds(outer.range, inner.range) && (span(outer.range) > span(inner.range) || outer.at < inner.at)

const linesOf = (range: Range) => (range.start === range.end ? `line ${range.start}` : `lines ${range.start}-${range.end}`)

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

const placeOf = (site: Graph['sites'][number]) => (site.line === undefined ? site.file : `${site.file}:${site.line}`)

function located(root: string, cwd: string, file: string): { abs: string; rel: string } {
  const abs = [path.resolve(root, file), path.resolve(cwd, file)].find((candidate) => fs.statSync(candidate, { throwIfNoEntry: false })?.isFile())
  if (abs === undefined) throw new Error(`${file} is not a file under ${root}`)
  const rel = projectPath(root, root, abs)
  if (rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) throw new Error(`${file} is outside the project ${root}`)
  return { abs, rel }
}

function functionsOf(entry: FileEntry | undefined): Fn[] {
  const fns = (entry?.functions ?? []).flatMap((fn, at) => (fn.twin === true ? [] : [{ at, own: fn.name, range: { start: fn.line, end: fn.endLine } }]))
  return fns.map((fn) => {
    const chain = fns.filter((other) => inside(fn, other)).sort((a, b) => span(b.range) - span(a.range) || a.at - b.at)
    return { at: fn.at, name: [...chain, fn].map((one) => one.own).join('.'), range: fn.range }
  })
}

function bySymbol(fns: Fn[], rel: string, symbol: string): Target {
  if (fns.length === 0) throw new Error(`no functions were found in ${rel}, so ${symbol} cannot be located; pass lines instead`)
  const exact = fns.filter((fn) => fn.name === symbol)
  const hits = exact.length > 0 ? exact : fns.filter((fn) => fn.name.endsWith(`.${symbol}`))
  if (hits.length === 0) throw new Error(`no function named ${symbol} in ${rel}; its functions are ${fns.map((fn) => fn.name).join(', ')}`)
  if (hits.length > 1) throw new Error(`${symbol} matches ${hits.length} functions in ${rel}, pass the full name: ${hits.map((fn) => `${fn.name} at line ${fn.range.start}`).join(', ')}`)
  const [fn] = hits as [Fn]
  return { heading: `\`${fn.name}\` in \`${rel}\` ${linesOf(fn.range)}`, fn: fn.at, range: fn.range }
}

function byLines(fns: Fn[], rel: string, range: Range): Target {
  const asked = `\`${rel}\` ${linesOf(range)}`
  const around = fns.filter((fn) => holds(fn.range, range)).sort((a, b) => span(a.range) - span(b.range) || b.at - a.at)[0]
  if (around === undefined) return { heading: `${asked}, not inside any function`, fn: null, range }
  const touched = fns.filter((fn) => inside(fn, around) && fn.range.start <= range.end && fn.range.end >= range.start)
  const nearest = touched.filter((fn) => !touched.some((other) => inside(fn, other)))
  const heading = `${asked}, inside \`${around.name}\` (${linesOf(around.range)})`
  if (nearest.length === 0) return { heading, fn: around.at, range }
  const parts = nearest.map((fn) => `\`${fn.name}\` (${linesOf(fn.range)})`).join(', ')
  return { heading: `${heading}\nThe range also covers ${parts}, so the graph is for \`${around.name}\`, the innermost function holding all of it.`, fn: around.at, range }
}

function permalinkPart(linker: Linker, rel: string, range: Range): string {
  if ('note' in linker) return linker.note
  const link = linker.link(rel, range.start, range.end)
  if (link === null) return linker.why(rel)
  return linker.drift === null ? link : `${link}\n${linker.drift}`
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
  const fns = functionsOf(entry)
  const target = input.symbol === undefined ? byLines(fns, rel, input.lines as Range) : bySymbol(fns, rel, input.symbol)
  const excerpt = excerptOf(fs.readFileSync(abs, 'utf8'), target.range, input.notes)

  const linker = await linkerFor(root)
  const graph = target.fn === null ? null : graphOf(map, rel, target.fn, depth)
  const parts = [target.heading, permalinkPart(linker, rel, target.range), excerpt, graph && graphPart(graph), graph && callersPart(graph, linker)]
  return parts.filter((part): part is string => typeof part === 'string').join('\n\n')
}
