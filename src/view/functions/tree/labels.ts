import type { FunctionRow } from '../../../../shared/types'
import { plural } from '../Mark'
import type { Tally } from './buckets/counts'
import { PROJECT, REASON, UNREACHED, UNREACHED_TITLE, indexOf, type Outline } from './outline'

const countsOf = (tally: Tally | undefined) =>
  `${plural(tally?.functions ?? 0, 'function')} · ${plural(tally?.starts ?? 0, 'starting point')}`

export function labelOf(outline: Outline, id: string, rows: FunctionRow[], project: string) {
  const tally = outline.tallies.get(id)
  const bucket = outline.buckets.get(id)
  if (bucket)
    return {
      title: bucket.label,
      tag: bucket.kind,
      notes: [
        countsOf(tally),
        `${plural(tally?.callsIn ?? 0, 'call')} in · ${(tally?.callsOut ?? 0).toLocaleString()} out`,
      ],
    }
  const entry = outline.groups.get(id)
  if (entry) return { title: REASON[entry.reason], notes: [entry.file, countsOf(tally)] }
  if (id === PROJECT) return { title: project, notes: [plural(rows.length, 'function')] }
  if (id === UNREACHED) return { title: UNREACHED_TITLE, notes: [plural(tally?.functions ?? 0, 'function')] }
  return { title: rows[indexOf(id)]?.name ?? id, notes: [] }
}
