import type { CallSite, CodeMap, FileEntry } from '../../shared/types'

export type Node = { key: string; file: string; name: string; line: number; sites: CallSite[] }

export type Hop = { node: Node; ipc?: string }

export type Graph = { at: (file: string, fn: number) => Node | undefined; hops: (site: CallSite) => Hop[] }

function handlersOf(files: FileEntry[]): Map<string, Node[]> {
  const handlers = new Map<string, Node[]>()
  for (const file of files) {
    for (const start of file.starts ?? []) {
      if (start.kind !== 'ipcHandler' || start.channel === undefined) continue
      const node = {
        key: `${file.path}@${start.channel}`,
        file: file.path,
        name: start.channel,
        line: start.line ?? 1,
        sites: start.sites ?? [],
      }
      handlers.set(start.channel, [...(handlers.get(start.channel) ?? []), node])
    }
  }
  return handlers
}

function channelsOf(files: FileEntry[]): Map<string, string[]> {
  const channels = new Map<string, string[]>()
  for (const file of files) {
    for (const start of file.starts ?? []) {
      if (start.kind !== 'bridge' || start.member === undefined || start.channel === undefined) continue
      const held = channels.get(start.member) ?? []
      if (!held.includes(start.channel)) channels.set(start.member, [...held, start.channel])
    }
  }
  return channels
}

export function graphOf(map: CodeMap): Graph {
  const files = map.folders.flatMap((folder) => folder.files)
  const byPath = new Map(files.map((file) => [file.path, file]))
  const handlers = handlersOf(files)
  const channels = channelsOf(files)

  const at = (file: string, fn: number): Node | undefined => {
    const functions = byPath.get(file)?.functions ?? []
    const entry = functions[fn]
    const nth = functions.slice(0, fn).filter((other) => other.name === entry?.name).length
    return entry && { key: `${file}#${entry.name}#${nth}`, file, name: entry.name, line: entry.line, sites: entry.sites ?? [] }
  }

  const hops = (site: CallSite): Hop[] => {
    if (!('bridge' in site)) {
      const node = at(site.file, site.fn)
      return node ? [{ node }] : []
    }
    return (channels.get(site.bridge) ?? []).flatMap((ipc) => (handlers.get(ipc) ?? []).map((node) => ({ node, ipc })))
  }

  return { at, hops }
}
