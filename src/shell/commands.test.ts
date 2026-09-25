import { afterEach, describe, expect, it } from 'vitest'
import {
  chordText,
  commandBindings,
  commandLabels,
  isEnabled,
  listCommands,
  matchCommands,
  provideCommands,
  revokeCommands,
  step,
  type Command,
} from './commands'

function command(id: string, label: string, extra: Partial<Command> = {}): Command {
  return { id, label, run: () => {}, ...extra }
}

const pane: Command[] = [
  command('pane.split.right', 'Split right', { keys: ['KeyP', 'KeyV'] }),
  command('pane.split.down', 'Split down', { keys: ['KeyP', 'KeyS'] }),
  command('pane.close', 'Close pane', { keys: ['KeyP', 'KeyQ'] }),
  command('code.jump', 'Jump to definition', { keys: ['KeyG'], scope: 'code' }),
]

const tokens: object[] = []

function provide(commands: Command[]): object {
  const token = {}
  tokens.push(token)
  provideCommands(token, commands)
  return token
}

afterEach(() => {
  for (const token of tokens.splice(0)) revokeCommands(token)
})

describe('the registry', () => {
  it('lists what every source has provided, in the order they provided it', () => {
    provide([pane[0]!])
    provide([pane[1]!])
    expect(listCommands().map((c) => c.id)).toEqual(['pane.split.right', 'pane.split.down'])
  })

  it('drops a source when it is revoked', () => {
    const token = provide(pane)
    revokeCommands(token)
    expect(listCommands()).toEqual([])
  })

  it('lets the newest source win an id that two sources both provide', () => {
    provide([command('pane.close', 'Close pane')])
    provide([command('pane.close', 'Shut pane')])
    expect(listCommands().map((c) => c.label)).toEqual(['Shut pane'])
  })

  it('has nothing before anything registers', () => {
    expect(listCommands()).toEqual([])
  })
})

describe('commandBindings', () => {
  it('binds only the commands that carry keys, keeping their scope', () => {
    const bindings = commandBindings([...pane, command('palette.open', 'Command palette')])
    expect(bindings.map((b) => b.command)).toEqual(['pane.split.right', 'pane.split.down', 'pane.close', 'code.jump'])
    expect(bindings.at(-1)).toEqual({ command: 'code.jump', keys: ['KeyG'], scope: 'code' })
  })

  it('ignores an empty key list', () => {
    expect(commandBindings([command('a', 'A', { keys: [] })])).toEqual([])
  })
})

describe('commandLabels', () => {
  it('maps every id to its label', () => {
    expect(commandLabels(pane)['pane.close']).toBe('Close pane')
  })
})

describe('isEnabled', () => {
  it('enables an unscoped command everywhere', () => {
    expect(isEnabled(pane[0]!, 'terminal')).toBe(true)
  })

  it('enables a scoped command only in its own scope', () => {
    expect(isEnabled(pane[3]!, 'code')).toBe(true)
    expect(isEnabled(pane[3]!, 'terminal')).toBe(false)
  })

  it('honours a command that declares itself unavailable', () => {
    expect(isEnabled(command('pane.close', 'Close pane', { enabled: false }), 'code')).toBe(false)
  })
})

describe('chordText', () => {
  it('spells the leader and every key of the chord', () => {
    expect(chordText(['KeyP', 'KeyV'], 'Space')).toBe('space p v')
  })

  it('spells a chord that is the leader pressed twice', () => {
    expect(chordText(['Space'], 'Space')).toBe('space space')
  })

  it('follows a remapped leader', () => {
    expect(chordText(['KeyQ'], 'Comma')).toBe('Comma q')
  })
})

describe('matchCommands', () => {
  it('keeps every command when the query is empty, in registration order', () => {
    expect(matchCommands('', pane, 'contract').map((c) => c.id)).toEqual(pane.map((c) => c.id))
  })

  it('drops a command whose label the query cannot spell', () => {
    expect(matchCommands('zzz', pane, 'contract')).toEqual([])
  })

  it('ranks a contiguous match above a scattered one', () => {
    const ranked = matchCommands('close', pane, 'contract')
    expect(ranked[0]?.id).toBe('pane.close')
  })

  it('ranks a word start above a mid word hit', () => {
    const ranked = matchCommands('sd', [command('a', 'Side bar'), command('b', 'Split down')], 'contract')
    expect(ranked[0]?.id).toBe('b')
  })

  it('matches out of order gaps, the point of a fuzzy palette', () => {
    expect(matchCommands('jmpdef', pane, 'code').map((c) => c.id)).toEqual(['code.jump'])
  })

  it('ignores case and spaces in the query', () => {
    expect(matchCommands('SPLIT R', pane, 'contract')[0]?.id).toBe('pane.split.right')
  })

  it('shows a command that is out of scope rather than hiding it', () => {
    const ranked = matchCommands('jump', pane, 'terminal')
    expect(ranked.map((c) => c.id)).toEqual(['code.jump'])
    expect(isEnabled(ranked[0]!, 'terminal')).toBe(false)
  })

  it('ranks every disabled command below every enabled one', () => {
    const ranked = matchCommands('', [pane[3]!, pane[2]!], 'terminal')
    expect(ranked.map((c) => c.id)).toEqual(['pane.close', 'code.jump'])
  })

  it('keeps a disabled exact match below a weaker enabled one', () => {
    const commands = [command('off', 'Close', { enabled: false }), command('on', 'Close pane')]
    expect(matchCommands('close', commands, 'contract').map((c) => c.id)).toEqual(['on', 'off'])
  })
})

describe('step', () => {
  it('moves down and up', () => {
    expect(step(0, 1, 3)).toBe(1)
    expect(step(2, -1, 3)).toBe(1)
  })

  it('wraps at both ends', () => {
    expect(step(2, 1, 3)).toBe(0)
    expect(step(0, -1, 3)).toBe(2)
  })

  it('clamps an index left over from a longer list', () => {
    expect(step(9, 0, 3)).toBe(0)
  })

  it('stays at zero with nothing to select', () => {
    expect(step(4, 1, 0)).toBe(0)
  })
})
