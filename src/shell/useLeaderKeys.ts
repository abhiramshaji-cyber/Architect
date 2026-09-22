import { useEffect, useMemo, useState } from 'react'
import { applicable, IDLE, nextSteps, press, timeout, type ChordState, type ChordStep, type KeyBinding } from './chords'
import { getLeaderKey } from './leaderKey'

const CHORD_TIMEOUT_MS = 1500

export interface CommandEntry {
  run: () => void
  label: string
}

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function useLeaderKeys(bindings: KeyBinding[], commands: Record<string, CommandEntry>, scope: string) {
  const [state, setState] = useState<ChordState>(IDLE)

  const scoped = useMemo(() => applicable(bindings, scope), [bindings, scope])

  useEffect(() => {
    if (!state.active) return

    const id = window.setTimeout(() => {
      const result = timeout(scoped, state)
      setState(result.state)
      if (result.fire) commands[result.fire]?.run()
    }, CHORD_TIMEOUT_MS)

    return () => window.clearTimeout(id)
  }, [state, scoped, commands])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return

      const leader = getLeaderKey()
      const result = press(scoped, state, e.code, leader)
      if (result.state === state && !result.fire) return

      e.preventDefault()
      setState(result.state)
      if (result.fire) commands[result.fire]?.run()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, scoped, commands])

  const steps: ChordStep[] = state.active
    ? nextSteps(
        scoped,
        state.keys,
        Object.fromEntries(Object.entries(commands).map(([id, c]) => [id, c.label]))
      )
    : []

  return { active: state.active, steps }
}
