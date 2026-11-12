import type { ModeId } from './shade'

export type Mode = {
  id: ModeId
  label: string
  token: string
  low: string
  high: string
  title: string
}

export const MODES: Mode[] = [
  {
    id: 'importance',
    label: 'Importance',
    token: '--live',
    low: '1',
    high: '5',
    title: 'How much of the call graph depends on the code, from 1 to 5',
  },
  {
    id: 'churn',
    label: 'Churn',
    token: '--age',
    low: '0',
    high: 'most',
    title: 'Commits that changed each function, on a log scale up to the busiest one',
  },
  {
    id: 'touched',
    label: 'AI touched',
    token: '--syn-keyword',
    low: 'no',
    high: 'yes',
    title: 'Files a Claude Code session added or changed, from the change history',
  },
  {
    id: 'unreached',
    label: 'Unreached',
    token: '--danger',
    low: 'reached',
    high: 'unreached',
    title: 'Code no starting point reaches through calls',
  },
]

export const FLOOR = 0.1
export const SPAN = 0.8

export type Rgb = [number, number, number]

export function rgbOf(color: string): Rgb | null {
  const hex = color.trim().replace(/^#/, '')
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
  if (!/^[0-9a-f]{6}$/i.test(full)) return null
  return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)) as Rgb
}

const GREY: Rgb = [128, 128, 128]

export function fillOf(color: string, value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null
  const rgb = rgbOf(color) ?? GREY
  const t = Math.min(1, Math.max(0, value))
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${(FLOOR + SPAN * t).toFixed(3)})`
}
