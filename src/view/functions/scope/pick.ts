import type { ScopeFolder } from '../../../../shared/types'

export type Pickable = ScopeFolder & { label: string }

export function folderOf(file: string): string {
  const cut = file.lastIndexOf('/')
  return cut < 0 ? '' : file.slice(0, cut)
}

export function pickable(folders: ScopeFolder[], scope: string, query: string): Pickable[] {
  const needle = query.trim().toLowerCase()
  return folders
    .map((folder) => ({ ...folder, label: scope === '' ? folder.path : folder.path.slice(scope.length + 1) }))
    .filter((folder) => needle === '' || folder.label.toLowerCase().includes(needle))
}

const SCOPE_KEY = 'architect.functions.scope:'

export function storedScope(root: string | null): string {
  try {
    return (root && localStorage.getItem(SCOPE_KEY + root)) || ''
  } catch {
    return ''
  }
}

export function storeScope(root: string | null, scope: string) {
  try {
    if (!root) return
    if (scope === '') localStorage.removeItem(SCOPE_KEY + root)
    else localStorage.setItem(SCOPE_KEY + root, scope)
  } catch {}
}
