import { useCallback, useEffect, useState } from 'react'
import { applicable, IDLE, nextSteps, press, timeout, type ChordState, type ChordStep } from './chords'
import { commandBindings, commandLabels, isEnabled, listCommands } from './commands'
import { getLeaderKey } from './leaderKey'

const CHORD_TIMEOUT_MS = 1500

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function useLeaderKeys(scope: string) {
  const [state, setState] = useState<ChordState>(IDLE)

  const scoped = useCallback(() => applicable(commandBindings(listCommands()), scope), [scope])

  const fire = useCallback(
    (id: string) => {
      const command = listCommands().find((entry) => entry.id === id)
      if (command && isEnabled(command, scope)) command.run()
    },
    [scope]
  )

  useEffect(() => {
    if (!state.active) return

    const id = window.setTimeout(() => {
      const result = timeout(scoped(), state)
      setState(result.state)
      if (result.fire) fire(result.fire)
    }, CHORD_TIMEOUT_MS)

    return () => window.clearTimeout(id)
  }, [state, scoped, fire])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return

      const result = press(scoped(), state, e.code, getLeaderKey())
      if (result.state === state && !result.fire) return

      e.preventDefault()
      setState(result.state)
      if (result.fire) fire(result.fire)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, scoped, fire])

  const commands = listCommands()
  const steps: ChordStep[] = state.active
    ? nextSteps(applicable(commandBindings(commands), scope), state.keys, commandLabels(commands))
    : []

  return { active: state.active, steps }
}
