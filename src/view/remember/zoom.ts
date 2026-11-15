import type { MapNode } from '../map/layout/nest'

function canZoom(node: MapNode): boolean {
  return ['component', 'top', 'folder', 'file'].includes(node.kind)
}

export function zoomKey(node: MapNode): string | null {
  return canZoom(node) ? `${node.kind}\0${node.path}` : null
}

function zoomable(node: MapNode): MapNode[] {
  return [node, ...node.children.flatMap(zoomable)].filter((each) => canZoom(each))
}

export function zoomOf(tree: MapNode, key: string | null): string {
  const [kind, path] = key?.split('\0') ?? []
  if (path === undefined) return ''
  const matches = zoomable(tree).filter((node) => node.path === path)
  return (matches.find((node) => node.kind === kind) ?? matches[0])?.id ?? ''
}
