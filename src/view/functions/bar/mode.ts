export type Mode = 'list' | 'tree' | 'focus'

export const MODES: { key: Mode; label: string }[] = [
  { key: 'list', label: 'List' },
  { key: 'tree', label: 'Tree' },
  { key: 'focus', label: 'Focus' },
]

const MODE_KEY = 'architect.functions.mode:'

export function storedMode(root: string | null): Mode {
  try {
    const stored = root ? localStorage.getItem(MODE_KEY + root) : null
    return MODES.find(({ key }) => key === stored)?.key ?? 'list'
  } catch {
    return 'list'
  }
}

export function storeMode(root: string | null, mode: Mode) {
  try {
    if (root) localStorage.setItem(MODE_KEY + root, mode)
  } catch {}
}
