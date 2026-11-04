import type { Architecture, Component } from './types'

export function topsOf(paths: string[], scope = ''): string[] {
  const base = scope === '' ? '' : `${scope}/`
  const tops = new Set<string>()
  for (const file of paths) {
    if (!file.startsWith(base)) continue
    const [top, ...rest] = file.slice(base.length).split('/')
    if (top && rest.length > 0) tops.add(top)
  }
  return [...tops].sort()
}

export function folderShaped(architecture: Architecture, tops: string[]): boolean {
  const base = architecture.scope ? `${architecture.scope}/` : ''
  const names = new Set(tops.map((top) => top.toLowerCase()))
  const wholes = new Set(tops.map((top) => `${base}${top}/**`))

  const folderLike = (c: Component) =>
    names.has(c.id.toLowerCase()) ||
    (c.owns.length > 0 && c.owns.every((glob) => wholes.has(glob.replace(/^\.\//, ''))))
  const inside = architecture.components.filter((c) => c.owns.length > 0 || names.has(c.id.toLowerCase()))

  return inside.length > 0 && inside.every(folderLike)
}
