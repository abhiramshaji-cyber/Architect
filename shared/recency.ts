import type { Change } from './types'

export function changeKey(file: string, line: number, name: string): string {
  return `${file}:${line}:${name}`
}

export function newer(a: Change | undefined, b: Change | undefined): Change | undefined {
  if (a === 'uncommitted' || b === undefined) return a
  if (b === 'uncommitted' || a === undefined) return b
  return b.at > a.at ? b : a
}

export type FileChurn = { commits: number; added: number; removed: number; binary?: true }

export type Churn = { days: number; files: Record<string, FileChurn>; functions: Record<string, number> }
