export type Mode = 'list' | 'tree' | 'focus'

export const MODES: { key: Mode; label: string }[] = [
  { key: 'list', label: 'List' },
  { key: 'tree', label: 'Tree' },
  { key: 'focus', label: 'Focus' },
]

const slotOf = (root: string, part = 'mode') => `architect.functions.${part}:${root}`

export function storedMode(root: string | null): Mode {
  try {
    const stored = root ? localStorage.getItem(slotOf(root)) : null
    return MODES.find(({ key }) => key === stored)?.key ?? 'list'
  } catch {
    return 'list'
  }
}

export function storeMode(root: string | null, mode: Mode) {
  try {
    if (root) localStorage.setItem(slotOf(root), mode)
  } catch {}
}

export function storedFocus(root: string | null): string | null {
  try {
    return root ? localStorage.getItem(slotOf(root, 'focus')) : null
  } catch {
    return null
  }
}

export function storeFocus(root: string | null, key: string) {
  try {
    if (root) localStorage.setItem(slotOf(root, 'focus'), key)
  } catch {}
}
