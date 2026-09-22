import { describe, expect, it } from 'vitest'
import { applicable, IDLE, matchChord, nextSteps, press, timeout, type KeyBinding } from './chords'

const bindings: KeyBinding[] = [
  { command: 'pane.split.right', keys: ['KeyP', 'KeyV'] },
  { command: 'pane.split.down', keys: ['KeyP', 'KeyS'] },
  { command: 'pane.close', keys: ['KeyP', 'KeyQ'] },
  { command: 'code.jump', keys: ['KeyG'], scope: 'code' },
]

const labels: Record<string, string> = {
  'pane.split.right': 'Split right',
  'pane.split.down': 'Split down',
  'pane.close': 'Close pane',
  'code.jump': 'Jump to definition',
}

describe('matchChord', () => {
  it('finds an exact match', () => {
    const { exact } = matchChord(bindings, ['KeyP', 'KeyV'])
    expect(exact?.command).toBe('pane.split.right')
  })

  it('finds continuations for a prefix', () => {
    const { exact, continuations } = matchChord(bindings, ['KeyP'])
    expect(exact).toBeUndefined()
    expect(continuations).toHaveLength(3)
  })

  it('reports neither for an unknown chord', () => {
    const { exact, continuations } = matchChord(bindings, ['KeyZ'])
    expect(exact).toBeUndefined()
    expect(continuations).toHaveLength(0)
  })
})

describe('nextSteps', () => {
  it('lists the next key for each continuation, labelled by command', () => {
    const steps = nextSteps(bindings, ['KeyP'], labels)
    expect(steps).toHaveLength(3)
    expect(steps.find((s) => s.key === 'KeyV')).toEqual({ key: 'KeyV', label: 'Split right', command: 'pane.split.right' })
  })

  it('is empty once no binding continues the chord', () => {
    expect(nextSteps(bindings, ['KeyP', 'KeyV'], labels)).toHaveLength(0)
  })
})

describe('applicable', () => {
  it('keeps global bindings for any scope', () => {
    expect(applicable(bindings, 'contract').filter((b) => b.command.startsWith('pane.'))).toHaveLength(3)
  })

  it('drops a scoped binding when the focused pane does not match', () => {
    expect(applicable(bindings, 'contract').some((b) => b.command === 'code.jump')).toBe(false)
  })

  it('keeps a scoped binding when the focused pane matches', () => {
    expect(applicable(bindings, 'code').some((b) => b.command === 'code.jump')).toBe(true)
  })
})

describe('press', () => {
  it('ignores a non-leader key while idle', () => {
    const { state, fire } = press(bindings, IDLE, 'KeyP', 'Space')
    expect(state).toEqual(IDLE)
    expect(fire).toBeUndefined()
  })

  it('arms the chord on the leader key', () => {
    const { state, fire } = press(bindings, IDLE, 'Space', 'Space')
    expect(state).toEqual({ active: true, keys: [] })
    expect(fire).toBeUndefined()
  })

  it('fires an unambiguous exact match immediately', () => {
    const solo: KeyBinding[] = [{ command: 'code.jump', keys: ['KeyG'], scope: 'code' }]
    const { state, fire } = press(solo, IDLE, 'Space', 'Space')
    expect(fire).toBeUndefined()
    expect(state).toEqual({ active: true, keys: [] })

    const armed = { active: true, keys: [] as string[] }
    const next = press(solo, armed, 'KeyG', 'Space')
    expect(next.fire).toBe('code.jump')
    expect(next.state).toEqual(IDLE)
  })

  it('stays armed on an ambiguous prefix that is also a full chord', () => {
    const ambiguous: KeyBinding[] = [
      { command: 'pane.close', keys: ['KeyP'] },
      { command: 'pane.split.right', keys: ['KeyP', 'KeyV'] },
    ]
    const { state, fire } = press(ambiguous, { active: true, keys: [] }, 'KeyP', 'Space')
    expect(fire).toBeUndefined()
    expect(state).toEqual({ active: true, keys: ['KeyP'] })
  })

  it('resolves the ambiguous prefix once a further key disambiguates it', () => {
    const ambiguous: KeyBinding[] = [
      { command: 'pane.close', keys: ['KeyP'] },
      { command: 'pane.split.right', keys: ['KeyP', 'KeyV'] },
    ]
    const armed = { active: true, keys: ['KeyP'] }
    const { state, fire } = press(ambiguous, armed, 'KeyV', 'Space')
    expect(fire).toBe('pane.split.right')
    expect(state).toEqual(IDLE)
  })

  it('cancels the chord on an unknown key mid sequence', () => {
    const armed = { active: true, keys: ['KeyP'] }
    const { state, fire } = press(bindings, armed, 'KeyZ', 'Space')
    expect(fire).toBeUndefined()
    expect(state).toEqual(IDLE)
  })

  it('cancels the chord on Escape', () => {
    const armed = { active: true, keys: ['KeyP'] }
    const { state, fire } = press(bindings, armed, 'Escape', 'Space')
    expect(fire).toBeUndefined()
    expect(state).toEqual(IDLE)
  })
})

describe('timeout', () => {
  it('does nothing while idle', () => {
    expect(timeout(bindings, IDLE)).toEqual({ state: IDLE })
  })

  it('fires the exact command an ambiguous prefix also matched', () => {
    const ambiguous: KeyBinding[] = [
      { command: 'pane.close', keys: ['KeyP'] },
      { command: 'pane.split.right', keys: ['KeyP', 'KeyV'] },
    ]
    const armed = { active: true, keys: ['KeyP'] }
    const { state, fire } = timeout(ambiguous, armed)
    expect(fire).toBe('pane.close')
    expect(state).toEqual(IDLE)
  })

  it('drops back to idle when the pending chord never resolved to a command', () => {
    const armed = { active: true, keys: ['KeyP'] }
    const { state, fire } = timeout(bindings, armed)
    expect(fire).toBeUndefined()
    expect(state).toEqual(IDLE)
  })
})
