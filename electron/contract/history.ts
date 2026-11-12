import { randomUUID } from 'node:crypto'
import type { Architecture, CodeMap, HistoryEntry } from '../../shared/types'

export type Diff = Pick<HistoryEntry, 'added' | 'changed' | 'removed'>

function diffNodes(before: Map<string, string>, after: Map<string, string>, touched: Set<string>): Diff {
  return {
    added: [...after.keys()].filter((id) => !before.has(id)),
    changed: [...after.keys()].filter((id) => before.has(id) && (before.get(id) !== after.get(id) || touched.has(id))),
    removed: [...before.keys()].filter((id) => !after.has(id)),
  }
}

function contractNodes(architecture: Architecture | null): Map<string, string> {
  const nodes = new Map<string, string>()
  for (const c of architecture?.components ?? []) nodes.set(c.id, JSON.stringify([c.purpose, c.owns, c.covers ?? []]))
  for (const e of architecture?.edges ?? []) nodes.set(`${e.from}->${e.to}`, e.label ?? '')
  return nodes
}

function codeNodes(map: CodeMap | null): Map<string, string> {
  const nodes = new Map<string, string>()
  for (const folder of map?.folders ?? []) {
    if (folder.path !== '') nodes.set(`folder:${folder.path}`, '')
    for (const file of folder.files) nodes.set(`codefile:${file.path}`, JSON.stringify(file.functions))
  }
  return nodes
}

function nodePath(id: string): string {
  return id.slice(id.indexOf(':') + 1)
}

export function isEmpty(diff: Diff): boolean {
  return diff.added.length + diff.changed.length + diff.removed.length === 0
}

export function contractDiff(before: Architecture | null, after: Architecture | null): Diff {
  return diffNodes(contractNodes(before), contractNodes(after), new Set())
}

export function codeDiff(before: CodeMap | null, after: CodeMap, touched: string[] = []): Diff {
  const nodes = codeNodes(after)
  const diff = diffNodes(codeNodes(before), nodes, new Set(touched.map((file) => `codefile:${file}`)))
  const moved = [...diff.added, ...diff.changed, ...diff.removed].map(nodePath)

  const folders = [...nodes.keys()].filter(
    (id) => id.startsWith('folder:') && !diff.added.includes(id) && moved.some((p) => p.startsWith(`${nodePath(id)}/`)),
  )
  return { ...diff, changed: [...diff.changed, ...folders] }
}

export type Touch = { file: string; session?: string; at?: number }

export type Attributed = Diff & { file?: string; session?: string }

function sessionsOf(touches: Touch[]): Map<string, string | undefined> {
  const sessions = new Map<string, string | undefined>()
  for (const { file, session } of touches) {
    sessions.set(file, sessions.has(file) && sessions.get(file) !== session ? undefined : session)
  }
  return sessions
}

export function attribute(diff: Diff, touches: Touch[]): Attributed[] {
  const sessions = sessionsOf(touches)
  const files = [...diff.added, ...diff.changed, ...diff.removed].filter((id) => id.startsWith('codefile:')).map(nodePath)

  function sessionOf(id: string): string | undefined {
    const where = nodePath(id)
    if (id.startsWith('codefile:')) return sessions.get(where)
    const under = new Set(files.filter((file) => file.startsWith(`${where}/`)).map((file) => sessions.get(file)))
    return under.size === 1 ? [...under][0] : undefined
  }

  const groups = new Map<string | undefined, Attributed>()
  for (const kind of ['added', 'changed', 'removed'] as const) {
    for (const id of diff[kind]) {
      const session = sessionOf(id)
      const group = groups.get(session) ?? { added: [], changed: [], removed: [] }
      group[kind].push(id)
      groups.set(session, group)
    }
  }

  const latest = [...new Set(touches.map((touch) => sessions.get(touch.file)).reverse())].reverse()
  const order = latest.includes(undefined) ? latest : [undefined, ...latest]
  return order.flatMap((session) => {
    const group = groups.get(session)
    if (!group) return []
    const file = touches.filter((touch) => sessions.get(touch.file) === session).at(-1)?.file
    return { ...group, ...(file === undefined ? {} : { file }), ...(session === undefined ? {} : { session }) }
  })
}

export function reclaim(
  entries: HistoryEntry[],
  file: string,
  session: string,
  recent: (entry: HistoryEntry) => boolean,
): { found: HistoryEntry; parts: HistoryEntry[] } | null {
  const id = `codefile:${file}`
  const found = entries.find((entry) => entry.source === 'code' && [...entry.added, ...entry.changed, ...entry.removed].includes(id))
  if (!found || found.session !== undefined || !recent(found)) return null

  const parts = attribute(found, [{ file, session }])
  const rest = parts.find((part) => part.session === undefined)
  const claimed = parts.find((part) => part.session === session)
  if (!claimed) return null

  const { file: _file, ...base } = found
  const kept = found.file === undefined || found.file === file ? base : found
  const own = { ...base, ...claimed, id: rest ? randomUUID() : found.id }
  return { found, parts: rest ? [own, { ...kept, ...rest }] : [own] }
}
