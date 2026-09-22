const LEADER_STORE_KEY = 'architect:leader'
const DEFAULT_LEADER = 'Space'

export function getLeaderKey(): string {
  try {
    return localStorage.getItem(LEADER_STORE_KEY) || DEFAULT_LEADER
  } catch {
    return DEFAULT_LEADER
  }
}

export function setLeaderKey(code: string): void {
  try {
    localStorage.setItem(LEADER_STORE_KEY, code)
  } catch {}
}
