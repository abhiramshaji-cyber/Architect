const slotOf = (view: string, part: string, root: string) => `architect.${view}.${part}:${root}`

export function recall(view: string, part: string, root: string | null): string | null {
  try {
    return root ? localStorage.getItem(slotOf(view, part, root)) : null
  } catch {
    return null
  }
}

export function keep(view: string, part: string, root: string | null, value: string | null) {
  try {
    if (root && value === null) localStorage.removeItem(slotOf(view, part, root))
    else if (root && value !== null) localStorage.setItem(slotOf(view, part, root), value)
  } catch {}
}
