import type { Evidence } from './evidence'

export type Group = { id: string; purpose: string; functions: number[] }

export type Flow = { from: string; to: string; label: string }

export type Reply = {
  title: string
  summary: string
  groups: Group[]
  flows: Flow[]
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const text = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')

const usableId = (id: string) => id !== '' && !/[\s`]/.test(id) && !id.includes('->') && !id.startsWith('#')

export function replyOf(raw: string, found: Evidence): Reply | string {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return 'the reply held no JSON'

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return 'the reply JSON did not parse'
  }

  const body = record(parsed)
  if (!body || !Array.isArray(body.components)) return 'the reply had no components list'

  // groups
  const refs = new Map(found.functions.map((fn, at) => [fn.ref, at]))
  const claimed = new Set<number>()
  const groups: Group[] = []
  for (const item of body.components) {
    const c = record(item)
    const id = text(c?.id)
    if (!c || !usableId(id) || groups.some((g) => g.id === id)) continue

    const functions = (Array.isArray(c.functions) ? c.functions : []).flatMap((ref) => {
      const at = refs.get(text(ref))
      if (at === undefined || claimed.has(at)) return []
      claimed.add(at)
      return [at]
    })
    groups.push({ id, purpose: text(c.purpose), functions })
  }
  if (groups.length === 0) return 'no component in the reply had a usable id'

  // flows
  const flows = (Array.isArray(body.flows) ? body.flows : []).flatMap((item) => {
    const f = record(item)
    const flow = {
      from: text(f?.from),
      to: text(f?.to),
      label: text(f?.label),
    }
    return flow.from !== '' && flow.to !== '' ? [flow] : []
  })

  return {
    title: text(body.title),
    summary: text(body.summary),
    groups,
    flows,
  }
}
