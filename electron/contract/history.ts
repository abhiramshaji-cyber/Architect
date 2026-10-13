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
  for (const c of architecture?.components ?? []) nodes.set(c.id, JSON.stringify([c.purpose, c.owns]))
  for (const e of architecture?.edges ?? []) nodes.set(`${e.from}->${e.to}`, '')
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
