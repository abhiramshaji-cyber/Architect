import picomatch from 'picomatch'
import { topsOf } from '../../shared/folders'
import type { Architecture, Convention, LimitRule, RuleEntry } from '../../shared/types'
import { consideredOf, effective, folderOf, jobsOf, limitOf } from '../rules/audit'
import type { SourceFacts } from '../rules/facts'
import { ruleLine } from '../rules/syntax'

type Area = { name: string; globs: string[] }

type Sample = { subject: string; amount: number; limit: number | 'off' }

const UNITS: Record<LimitRule, { each: string; unit: string }> = {
  lines: { each: 'file', unit: 'lines' },
  jobs: { each: 'file', unit: 'unrelated groups of exported functions' },
  files: { each: 'folder', unit: 'code files' },
}

function areasOf(architecture: Architecture | null, paths: string[]): Area[] {
  const drawn = (architecture?.components ?? []).filter((c) => c.owns.length > 0 && c.owns.every((glob) => !glob.startsWith('!')))
  if (drawn.length > 0) return drawn.map((c) => ({ name: c.id, globs: c.owns }))

  const base = architecture?.scope ? `${architecture.scope}/` : ''
  return topsOf(paths, architecture?.scope).map((top) => ({ name: top, globs: [`${base}${top}/**`] }))
}

function convention(area: Area, rule: LimitRule, samples: Sample[]): Convention[] {
  if (samples.length < 2) return []

  const most = Math.max(...samples.map((sample) => sample.amount))
  const limits = samples.flatMap((sample) => (sample.limit === 'off' ? [] : [sample.limit]))
  const least = limits.length > 0 ? Math.min(...limits) : Number.POSITIVE_INFINITY
  if (most <= 0 || most >= least) return []

  const { each, unit } = UNITS[rule]
  const entry: RuleEntry = { rule, limit: most, globs: area.globs }
  const largest = samples.filter((sample) => sample.amount === most).map((sample) => sample.subject)
  const inForce = Number.isFinite(least) ? `the tightest limit in force there is ${least}` : 'no limit is in force there'
  return [
    {
      source: 'measured',
      title: `${area.name}: every ${each} has at most ${most} ${unit}`,
      detail: `Counted over ${samples.length} ${each}s under ${area.globs.join(', ')}; ${inForce}.`,
      files: largest,
      rule: ruleLine(entry),
    },
  ]
}

export function measured(architecture: Architecture | null, sources: SourceFacts[]): Convention[] {
  const entries = effective(architecture?.rules)
  const considered = consideredOf(entries, sources, architecture?.scope)
  const folders = new Map<string, number>()
  for (const file of considered) folders.set(folderOf(file.path) || '.', (folders.get(folderOf(file.path) || '.') ?? 0) + 1)

  return areasOf(
    architecture,
    considered.map((file) => file.path),
  ).flatMap((area) => {
    const inArea = picomatch(area.globs, { dot: true })
    const held = considered.filter((file) => inArea(file.path))
    const perFile = (rule: LimitRule, amount: (file: SourceFacts) => number) =>
      convention(
        area,
        rule,
        held.map((file) => ({ subject: file.path, amount: amount(file), limit: limitOf(entries, rule, file.path) })),
      )
    const perFolder = [...folders].filter(([folder]) => inArea(folder) && held.some((file) => (folderOf(file.path) || '.') === folder))

    return [
      ...perFile('lines', (file) => file.lines),
      ...perFile('jobs', (file) => jobsOf(file.path, file.functions).length),
      ...convention(
        area,
        'files',
        perFolder.map(([folder, count]) => ({ subject: folder, amount: count, limit: limitOf(entries, 'files', folder) })),
      ),
    ]
  })
}
