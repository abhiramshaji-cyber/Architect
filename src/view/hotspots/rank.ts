import { changeKey, type Churn } from '../../../shared/recency'
import type { CodeMap } from '../../../shared/types'

export type Level = 'files' | 'functions'

export type Hotspot = { key: string; file: string; line: number; name?: string; lines: number; commits: number; added?: number; removed?: number; score: number }

type Measured = Omit<Hotspot, 'score'>

function measure(map: CodeMap, churn: Churn, level: Level): Measured[] {
  const files = map.folders.flatMap((folder) => folder.files)
  if (level === 'files') {
    return files.map((file) => {
      const changed = churn.files[file.path]
      return { key: file.path, file: file.path, line: 1, lines: file.lines ?? 0, commits: changed?.commits ?? 0, added: changed?.added ?? 0, removed: changed?.removed ?? 0 }
    })
  }
  return files.flatMap((file) =>
    file.functions.map((fn) => {
      const key = changeKey(file.path, fn.line, fn.name)
      return { key, file: file.path, line: fn.line, name: fn.name, lines: Math.max(0, fn.endLine - fn.line + 1), commits: churn.functions[key] ?? 0 }
    }),
  )
}

function order(a: Hotspot, b: Hotspot): number {
  return b.score - a.score || b.commits - a.commits || b.lines - a.lines || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
}

export function rank(map: CodeMap, churn: Churn, level: Level): Hotspot[] {
  const measured = measure(map, churn, level)
  const most = measured.reduce((top, item) => ({ lines: Math.max(top.lines, item.lines), commits: Math.max(top.commits, item.commits) }), { lines: 0, commits: 0 })
  const share = (value: number, max: number) => (max > 0 ? value / max : 0)
  return measured.map((item) => ({ ...item, score: share(item.lines, most.lines) * share(item.commits, most.commits) })).sort(order)
}
