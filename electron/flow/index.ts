import { z } from 'zod'
import type { Architecture, CodeMap, Flow, FlowStep } from '../../shared/types'
import { entryFiles, type EntryFiles } from '../functions'
import { entriesOf } from '../functions/facts'
import { lanesOf } from './lanes'
import { graphOf } from './nodes'
import { walk, type Walked } from './walk'

const askSchema = z.object({
  file: z.string(),
  name: z.string(),
  line: z.number().int(),
  depth: z.number().int().min(1).max(64),
  open: z.array(z.string()).max(4096),
})

function stepOf(walked: Walked, lanes: ReturnType<typeof lanesOf>): FlowStep {
  const { caller, hop, line, times, depth, mark, more } = walked
  const target = hop.node
  const forbidden = lanes.forbidden(caller.file, target.file)
  return {
    key: target.key,
    from: lanes.of(caller.file),
    to: lanes.of(target.file),
    file: caller.file,
    line,
    callee: target.name,
    target: target.file,
    targetLine: target.line,
    depth,
    times,
    ...(mark ? { mark } : {}),
    ...(more ? { more } : {}),
    ...(hop.ipc === undefined ? {} : { ipc: hop.ipc }),
    ...(forbidden === undefined ? {} : { forbidden }),
  }
}

export function flowOf(map: CodeMap, entries: EntryFiles, architecture: Architecture | null, ask: unknown): Flow {
  const parsed = askSchema.safeParse(ask)
  if (!parsed.success) throw new Error(`not a flow request: ${parsed.error.issues[0]?.message ?? 'unknown shape'}`)
  const { file, name, line, depth, open } = parsed.data

  const graph = graphOf(map)
  const functions = map.folders.flatMap((folder) => folder.files).find((entry) => entry.path === file)?.functions ?? []
  const fn = functions.findIndex((entry) => entry.name === name && entry.line === line)
  const start = graph.at(file, fn)
  if (!start) throw new Error(`${name} at ${file}:${line} is not in the scan`)
  const entry = entriesOf(map, entries).get(`${file}\0${fn}`)
  if (!entry) throw new Error(`${name} at ${file}:${line} is not a starting point`)

  const lanes = lanesOf(map, architecture)
  const walked = walk(start, graph, depth, new Set(open))
  const steps = walked.steps.map((step) => stepOf(step, lanes))
  const lane = lanes.of(file)
  const order = [...new Set([lane, ...steps.flatMap((step) => [step.from, step.to])])]

  return { start: name, file, line, entry, lane, lanes: order, steps, depth, contract: architecture !== null, cut: walked.cut }
}

export function flowIn(root: string, architecture: Architecture | null, map: CodeMap, ask: unknown): Flow {
  return flowOf(map, entryFiles(root, map), architecture, ask)
}
