export interface KeyBinding {
  command: string
  keys: string[]
  scope?: string
}

export interface ChordStep {
  key: string
  label: string
  command?: string
}

export interface ChordState {
  active: boolean
  keys: string[]
}

export const IDLE: ChordState = { active: false, keys: [] }

export interface ChordResult {
  state: ChordState
  fire?: string
}

function startsWith(keys: string[], prefix: string[]): boolean {
  return prefix.every((key, i) => keys[i] === key)
}

export function applicable(bindings: KeyBinding[], scope: string): KeyBinding[] {
  return bindings.filter((b) => !b.scope || b.scope === scope)
}

export function matchChord(bindings: KeyBinding[], pressed: string[]) {
  const exact = bindings.find((b) => b.keys.length === pressed.length && startsWith(b.keys, pressed))
  const continuations = bindings.filter((b) => b.keys.length > pressed.length && startsWith(b.keys, pressed))
  return { exact, continuations }
}

export function nextSteps(bindings: KeyBinding[], pressed: string[], labels: Record<string, string>): ChordStep[] {
  const steps = new Map<string, ChordStep>()

  for (const b of bindings) {
    if (b.keys.length <= pressed.length || !startsWith(b.keys, pressed)) continue
    const key = b.keys[pressed.length]
    if (key === undefined || steps.has(key)) continue
    const leaf = b.keys.length === pressed.length + 1
    steps.set(key, {
      key,
      label: leaf ? (labels[b.command] ?? b.command) : `${formatKey(key)}...`,
      command: leaf ? b.command : undefined,
    })
  }

  return [...steps.values()]
}

export function press(bindings: KeyBinding[], state: ChordState, key: string, leader: string): ChordResult {
  if (!state.active) {
    if (key !== leader) return { state }
    return { state: { active: true, keys: [] } }
  }

  if (key === 'Escape') return { state: IDLE }

  const keys = [...state.keys, key]
  const { exact, continuations } = matchChord(bindings, keys)

  if (continuations.length > 0) return { state: { active: true, keys } }
  if (exact) return { state: IDLE, fire: exact.command }
  return { state: IDLE }
}

export function timeout(bindings: KeyBinding[], state: ChordState): ChordResult {
  if (!state.active) return { state }
  const { exact } = matchChord(bindings, state.keys)
  return exact ? { state: IDLE, fire: exact.command } : { state: IDLE }
}

export function formatKey(code: string): string {
  if (code === 'Space') return 'space'
  if (code.startsWith('Key')) return code.slice(3).toLowerCase()
  if (code.startsWith('Digit')) return code.slice(5)
  return code
}
