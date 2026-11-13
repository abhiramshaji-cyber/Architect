import { errorText } from '../../shared/text/error'
import type {
  Architecture,
  DiffHunk,
  FunctionImpact,
  FunctionRow,
  GitResult,
  Proposal,
  ReviewDetail,
  ReviewItem,
} from '../../shared/types'
import { apply, ownership, parse, serialize } from '../contract/graph'
import { textDiff } from '../git/diff'
import { functionsIn } from '../scan/scan'
import type { Texts } from './queue'

type Body = { name: string; line: number; text: string }

function bodies(source: string, file: string): Map<string, Body> {
  const lines = source.split('\n')
  const seen = new Map<string, number>()
  const found = new Map<string, Body>()

  for (const fn of functionsIn(source, file)) {
    const nth = seen.get(fn.name) ?? 0
    seen.set(fn.name, nth + 1)
    found.set(`${fn.name}#${nth}`, { name: fn.name, line: fn.line, text: lines.slice(fn.line - 1, fn.endLine).join('\n') })
  }
  return found
}

export function functionImpact(file: string, before: string, after: string, rows: FunctionRow[]): FunctionImpact[] {
  const old = bodies(before, file)
  const next = bodies(after, file)

  const known = new Map<string, FunctionRow>()
  for (const row of rows) if (row.file === file && !known.has(row.name)) known.set(row.name, row)

  const impact = (body: Body, change: FunctionImpact['change']): FunctionImpact => {
    const row = known.get(body.name)
    return { name: body.name, change, line: body.line, fanIn: row?.fanIn ?? null, importance: row?.importance ?? null }
  }

  const touched = [...next].flatMap(([key, body]) => {
    const was = old.get(key)
    if (!was) return [impact(body, 'added')]
    return was.text === body.text ? [] : [impact(body, 'changed')]
  })
  const removed = [...old].flatMap(([key, body]) => (next.has(key) ? [] : [impact(body, 'removed')]))

  return [...touched, ...removed]
}

export function ownersOf(file: string, architecture: Architecture | null): string[] {
  if (!architecture) return []

  const found = ownership([file], architecture.components)
  return [...found.owned.map((entry) => entry.owner), ...found.multi.flatMap((entry) => entry.owners)]
}

function proposed(architecture: Architecture | null, proposal: Proposal): Architecture {
  if (proposal.kind === 'contract') return parse(proposal.markdown)
  if (!architecture) throw new Error('this project has no architect.md to change')
  return apply(architecture, proposal)
}

function hunksOr(result: GitResult<DiffHunk[]>): { hunks: DiffHunk[]; error: string | null } {
  if (result.ok) return { hunks: result.value, error: null }
  return { hunks: [], error: result.error.kind === 'failed' ? result.error.stderr : `git: ${result.error.kind}` }
}

async function proposalDetail(item: Extract<ReviewItem, { kind: 'proposal' }>, architecture: Architecture | null): Promise<ReviewDetail> {
  const { proposal } = item
  const before = proposal.kind === 'contract' ? null : architecture
  const owners = proposal.kind === 'package' || proposal.kind === 'file' ? [proposal.component] : []
  const empty = { before, owners, file: 'architect.md', functions: [] }

  let after: Architecture
  try {
    after = proposed(architecture, proposal)
  } catch (err) {
    return { ...empty, after: null, hunks: [], error: errorText(err) }
  }

  const text = proposal.kind === 'contract' ? proposal.markdown : serialize(after)
  return { ...empty, after, ...hunksOr(await textDiff(before ? serialize(before) : '', text)) }
}

export async function detailOf(
  item: ReviewItem,
  texts: Texts | null,
  architecture: Architecture | null,
  rows: FunctionRow[],
): Promise<ReviewDetail> {
  if (item.kind === 'proposal') return proposalDetail(item, architecture)

  const { before, after } = texts ?? { before: '', after: '' }
  return {
    before: architecture,
    after: architecture,
    owners: ownersOf(item.file, architecture),
    file: item.file,
    functions: functionImpact(item.file, before, after, rows),
    ...hunksOr(await textDiff(before, after)),
  }
}
