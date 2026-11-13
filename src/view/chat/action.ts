import { z } from 'zod'
import type { Architecture } from '../../../shared/types'
import { route } from './shape'

const Focus = z.object({
  components: z.array(z.string()).min(1),
  depth: z.number().int().min(0).max(3).optional(),
  rest: z.enum(['dim', 'hide']).optional()
})

const Path = z.object({ from: z.string(), to: z.string() })

export const View = z.object({
  layout: z.enum(['top-down', 'left-right']),
  spacing: z.enum(['compact', 'normal', 'roomy']),
  labels: z.boolean(),
  externals: z.boolean(),
  group: z.boolean(),
  hide: z.array(z.string()),
  focus: Focus.nullable(),
  path: Path.nullable()
})

export type ViewState = z.infer<typeof View>

export const DEFAULT_VIEW: ViewState = {
  layout: 'top-down',
  spacing: 'normal',
  labels: true,
  externals: true,
  group: false,
  hide: [],
  focus: null,
  path: null
}

const FIELDS: Record<string, z.ZodType> = { ...View.shape, reset: z.boolean() }

export type Applied = { view: ViewState; notes: string[] }

function namer(architecture: Architecture, notes: string[]) {
  const ids = architecture.components.map((c) => c.id)
  return (name: string): string | null => {
    if (ids.includes(name)) return name
    const loose = ids.filter((id) => id.toLowerCase() === name.trim().toLowerCase())
    if (loose.length === 1 && loose[0]) return loose[0]
    notes.push(`The diagram has no component named "${name}"`)
    return null
  }
}

export function applyAction(view: ViewState, raw: unknown, architecture: Architecture): Applied {
  if (raw === null || raw === undefined) return { view, notes: [] }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { view, notes: ['Ignored a view change that was not a set of settings'] }

  const notes: string[] = []
  const fields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    const field = FIELDS[key]?.safeParse(value)
    if (!field) notes.push(`Ignored the unknown view setting "${key}"`)
    else if (!field.success) notes.push(`Ignored the view setting "${key}": its value was not valid`)
    else fields[key] = field.data
  }

  const known = namer(architecture, notes)
  const next: ViewState = { ...(fields.reset === true ? DEFAULT_VIEW : view) }
  const set = (key: keyof ViewState) => key in fields && Object.assign(next, { [key]: fields[key] })
  for (const key of ['layout', 'spacing', 'labels', 'externals', 'group'] as const) set(key)

  if (fields.hide) next.hide = [...new Set((fields.hide as string[]).map(known).filter((id) => id !== null))]

  if ('focus' in fields) {
    const focus = fields.focus as ViewState['focus']
    const components = focus ? [...new Set(focus.components.map(known).filter((id) => id !== null))] : []
    if (focus && components.length === 0) notes.push('Kept the focus as it was: none of its components are in the diagram')
    else next.focus = focus && { ...focus, components }
  }

  if ('path' in fields) {
    const path = fields.path as ViewState['path']
    const ends = path && { from: known(path.from), to: known(path.to) }
    if (!path) next.path = null
    else if (ends?.from && ends.to && route(architecture, ends.from, ends.to)) next.path = { from: ends.from, to: ends.to }
    else if (ends?.from && ends.to) notes.push(`The diagram has no path from ${ends.from} to ${ends.to}`)
  }

  return { view: next, notes }
}
