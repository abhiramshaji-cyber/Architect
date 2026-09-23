export const TAB_GROUP = 'architect'
export const LAST_TAB = 9
export const TAB_DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9']

export function tabIndex(digit: number, count: number): number | null {
  if (!Number.isInteger(digit) || digit < 1 || digit > LAST_TAB) return null
  if (count < 1) return null
  if (digit === LAST_TAB) return count - 1
  return digit <= count ? digit - 1 : null
}

export function owner(claims: Map<number, string>, root: string): number | null {
  for (const [id, held] of claims) if (held === root) return id
  return null
}

export function claim(
  claims: Map<number, string>,
  live: (id: number) => boolean,
  window: number,
  root: string,
): boolean {
  const held = owner(claims, root)

  if (held !== null && held !== window) {
    if (live(held)) return false
    claims.delete(held)
  }

  claims.set(window, root)
  return true
}
