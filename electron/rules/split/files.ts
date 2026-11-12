import path from 'node:path'
import type { FileSplit, FunctionEntry, LimitRule, RuleEntry, SplitGroup } from '../../../shared/types'
import { folderOf, isSkipped, jobsOf, limitOf, type Job } from '../audit'
import type { SourceFacts } from '../facts'
import { jobName } from './name'

type Over = NonNullable<FileSplit['over']['lines']>

type Named = { name?: string; unnamed?: string; exported: FunctionEntry[]; members: FunctionEntry[] }

function projectLimit(entries: RuleEntry[], rule: LimitRule): number | 'off' {
  const found = entries.filter((entry) => entry.rule === rule && entry.globs.length === 0).at(-1)
  return found && 'limit' in found ? found.limit : 'off'
}

function overOf(entries: RuleEntry[], rule: LimitRule, file: string, count: number): Over | undefined {
  const limit = limitOf(entries, rule, file)
  if (limit === 'off') return undefined
  const project = projectLimit(entries, rule)
  if (count <= (project === 'off' ? limit : Math.min(limit, project))) return undefined
  return project === 'off' || project === limit ? { count, limit } : { count, limit, project }
}

function spanOf(members: FunctionEntry[]): number {
  const same = (a: FunctionEntry, b: FunctionEntry) => a.line === b.line && a.endLine === b.endLine
  const inside = (fn: FunctionEntry, at: number) =>
    members.some((other, j) => j !== at && other.line <= fn.line && fn.endLine <= other.endLine && (!same(fn, other) || j < at))
  return members.filter((fn, at) => !inside(fn, at)).reduce((sum, fn) => sum + fn.endLine - fn.line + 1, 0)
}

function folderFor(file: string): string {
  const base = path.posix.basename(file).replace(/\.[^.]*$/, '')
  const parent = folderOf(file)
  if (base === 'index') return parent
  return parent ? `${parent}/${base}` : base
}

function named(jobs: Job[]): Named[] {
  const merged = new Map<string, Named>()
  const unnamed: Named[] = []
  for (const { exported, members } of jobs) {
    const job = jobName(exported.map((fn) => fn.name), members.map((fn) => fn.name))
    const held = 'name' in job ? merged.get(job.name) : undefined
    if ('unnamed' in job) unnamed.push({ unnamed: job.unnamed, exported, members })
    else merged.set(job.name, { name: job.name, exported: [...(held?.exported ?? []), ...exported], members: [...(held?.members ?? []), ...members] })
  }
  return [...merged.values(), ...unnamed]
}

const stem = (file: string) => file.replace(/\.[^./]*$/, '').toLowerCase()

function groupOf(job: Named, folder: string, ext: string, taken: string[]): SplitGroup {
  const target = job.name === undefined ? undefined : folder ? `${folder}/${job.name}${ext}` : `${job.name}${ext}`
  const clash = target === undefined ? undefined : taken.find((other) => stem(other) === stem(target))
  const place = target === undefined ? { unnamed: job.unnamed } : clash ? { unnamed: `${clash} already exists` } : { name: job.name, file: target }
  const members = [...job.members].sort((a, b) => a.line - b.line)
  return {
    ...place,
    exported: [...job.exported].sort((a, b) => a.line - b.line).map((fn) => fn.name),
    members: members.map(({ name, line, endLine }) => ({ name, line, endLine })),
    lines: spanOf(members),
  }
}

export function fileSplit(entries: RuleEntry[], file: SourceFacts, filesIn: (folder: string) => string[]): FileSplit | null {
  const jobs = jobsOf(file.path, file.functions)
  const lines = overOf(entries, 'lines', file.path, file.lines)
  const tooMany = overOf(entries, 'jobs', file.path, jobs.length)
  if (!lines && !tooMany) return null

  const folder = folderFor(file.path)
  const beside = filesIn(folder).filter((other) => other !== file.path && folderOf(other) === folder)
  const groups = named(jobs).map((job) => groupOf(job, folder, path.posix.extname(file.path), [...beside, file.path]))
  const grouped = new Set(jobs.flatMap((job) => job.members))
  const counted = beside.filter((other) => !isSkipped(entries, other)).length
  const split: FileSplit = {
    kind: 'file',
    path: file.path,
    lines: file.lines,
    over: { ...(lines ? { lines } : {}), ...(tooMany ? { jobs: tooMany } : {}) },
    folder: folder || '.',
    entry: file.path,
    groups: groups.sort((a, b) => (a.members[0]?.line ?? 0) - (b.members[0]?.line ?? 0)),
    stays: {
      lines: Math.max(0, file.lines - groups.reduce((sum, group) => sum + group.lines, 0)),
      functions: file.functions.filter((fn) => !grouped.has(fn)).map((fn) => fn.name),
    },
    files: { count: counted + groups.length + (folderOf(file.path) === folder ? 1 : 0), limit: limitOf(entries, 'files', folder || '.') },
  }
  if (jobs.length === 0) return { ...split, blocked: 'no exported function to group into a job' }
  if (jobs.length === 1) return { ...split, blocked: 'every exported function sits in one connected group, so no job splits off' }
  return split
}
