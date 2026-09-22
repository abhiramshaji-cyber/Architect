import { describe, expect, it } from 'vitest'
import type { Architecture } from '../../shared/types'
import { parse, serialize } from '../../electron/contract/graph'
import {
  addComponent,
  addEdge,
  removeComponent,
  removeEdge,
  renameComponent,
  setOwns,
  setPurpose,
  type OpResult
} from './edit-ops'

function base(): Architecture {
  return {
    title: 'Test',
    summary: 'a test architecture',
    components: [
      { id: 'ui', purpose: 'renders', owns: ['src/**'] },
      { id: 'api', purpose: 'serves', owns: [] },
      { id: 'db', purpose: 'stores', owns: [] }
    ],
    edges: [
      { from: 'ui', to: 'api' },
      { from: 'api', to: 'db' }
    ],
    forbidden: [{ from: 'ui', to: 'db', reason: 'no direct database access' }],
    packages: ['zod']
  }
}

function ok(result: OpResult): Architecture {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`)
  return result.architecture
}

function error(result: OpResult): string {
  if (result.ok) throw new Error('expected an error')
  return result.error
}

describe('addComponent', () => {
  it('appends a component with an empty purpose and owns', () => {
    const next = ok(addComponent(base(), 'cache'))
    expect(next.components.at(-1)).toEqual({ id: 'cache', purpose: '', owns: [] })
  })

  it('trims the id', () => {
    expect(ok(addComponent(base(), '  cache  ')).components.at(-1)?.id).toBe('cache')
  })

  it('rejects an id that is empty after trimming', () => {
    expect(error(addComponent(base(), '   '))).toBe('id cannot be empty')
  })

  it('rejects an id that would not survive the markdown round trip', () => {
    expect(error(addComponent(base(), 'my cache'))).toContain('one word')
    expect(error(addComponent(base(), 'a->b'))).toContain('one word')
  })

  it('rejects an id that already exists', () => {
    expect(error(addComponent(base(), 'api'))).toBe('component "api" already exists')
  })
})

describe('removeComponent', () => {
  it('errors on a missing id', () => {
    expect(error(removeComponent(base(), 'nope'))).toBe('unknown component "nope"')
  })

  it('cascades to edges in both directions and to forbidden entries', () => {
    const a = base()
    a.edges.push({ from: 'db', to: 'ui' })
    a.forbidden.push({ from: 'db', to: 'api', reason: 'layering' })
    a.forbidden.push({ from: 'api', to: 'ui', reason: 'no back calls' })

    const next = ok(removeComponent(a, 'db'))

    expect(next.components.map((c) => c.id)).toEqual(['ui', 'api'])
    expect(next.edges).toEqual([{ from: 'ui', to: 'api' }])
    expect(next.forbidden).toEqual([{ from: 'api', to: 'ui', reason: 'no back calls' }])
  })

  it('leaves packages untouched', () => {
    expect(ok(removeComponent(base(), 'db')).packages).toEqual(['zod'])
  })
})

describe('renameComponent', () => {
  it('rewrites the component, every edge and every forbidden entry', () => {
    const next = ok(renameComponent(base(), 'db', 'store'))

    expect(next.components.map((c) => c.id)).toEqual(['ui', 'api', 'store'])
    expect(next.edges).toEqual([
      { from: 'ui', to: 'api' },
      { from: 'api', to: 'store' }
    ])
    expect(next.forbidden).toEqual([{ from: 'ui', to: 'store', reason: 'no direct database access' }])
  })

  it('rewrites the from side of an edge too', () => {
    const next = ok(renameComponent(base(), 'api', 'server'))
    expect(next.edges).toEqual([
      { from: 'ui', to: 'server' },
      { from: 'server', to: 'db' }
    ])
  })

  it('is a successful no-op when the id is identical', () => {
    const a = base()
    expect(ok(renameComponent(a, 'db', 'db'))).toEqual(a)
  })

  it('rejects renaming onto an existing id', () => {
    expect(error(renameComponent(base(), 'db', 'api'))).toBe('component "api" already exists')
  })

  it('errors on a missing source', () => {
    expect(error(renameComponent(base(), 'nope', 'x'))).toBe('unknown component "nope"')
  })

  it('rejects a target that breaks the grammar', () => {
    expect(error(renameComponent(base(), 'db', 'data store'))).toContain('one word')
    expect(error(renameComponent(base(), 'db', '  '))).toBe('id cannot be empty')
  })
})

describe('setPurpose', () => {
  it('trims the purpose', () => {
    const next = ok(setPurpose(base(), 'api', '  serves http  '))
    expect(next.components.find((c) => c.id === 'api')?.purpose).toBe('serves http')
  })

  it('errors on a missing id', () => {
    expect(error(setPurpose(base(), 'nope', 'x'))).toBe('unknown component "nope"')
  })

  it('rejects a purpose that breaks the grammar', () => {
    expect(error(setPurpose(base(), 'api', 'one\ntwo'))).toBe('purpose must be a single line')
    expect(error(setPurpose(base(), 'api', '### api'))).toBe('purpose cannot start with a markdown heading')
    expect(error(setPurpose(base(), 'api', '## api'))).toBe('purpose cannot start with a markdown heading')
    expect(ok(setPurpose(base(), 'api', '#1 priority')).components[1]?.purpose).toBe('#1 priority')
    expect(error(setPurpose(base(), 'api', '<!-- hi -->'))).toBe('purpose cannot start with "<!--"')
    expect(error(setPurpose(base(), 'api', 'owns: src'))).toBe('purpose cannot start with "owns:"')
  })
})

describe('setOwns', () => {
  it('trims, drops empties and removes duplicates in first-seen order', () => {
    const next = ok(setOwns(base(), 'api', [' b/**  ', '', 'a/**', '   ', 'b/**']))
    expect(next.components.find((c) => c.id === 'api')?.owns).toEqual(['b/**', 'a/**'])
  })

  it('errors on a missing id', () => {
    expect(error(setOwns(base(), 'nope', []))).toBe('unknown component "nope"')
  })

  it('rejects a glob that breaks the grammar', () => {
    expect(error(setOwns(base(), 'api', ['src/`x`']))).toContain('backtick')
    expect(error(setOwns(base(), 'api', ['src\n/x']))).toContain('single line')
  })
})

describe('addEdge', () => {
  it('appends the edge', () => {
    const withCache = ok(addComponent(base(), 'cache'))
    expect(ok(addEdge(withCache, 'db', 'cache')).edges.at(-1)).toEqual({ from: 'db', to: 'cache' })
  })

  it('rejects an unknown from and an unknown to', () => {
    expect(error(addEdge(base(), 'nope', 'db'))).toBe('unknown component "nope"')
    expect(error(addEdge(base(), 'ui', 'nope'))).toBe('unknown component "nope"')
  })

  it('rejects a self edge', () => {
    expect(error(addEdge(base(), 'ui', 'ui'))).toBe('a component cannot depend on itself')
  })

  it('rejects a pair that already exists', () => {
    expect(error(addEdge(base(), 'ui', 'api'))).toBe('edge "ui -> api" already exists')
  })

  it('refuses a forbidden pair and surfaces the reason', () => {
    expect(error(addEdge(base(), 'ui', 'db'))).toBe('edge "ui -> db" is forbidden: no direct database access')
  })

  it('rejects a two node cycle', () => {
    expect(error(addEdge(base(), 'db', 'ui'))).toBe('edge "db -> ui" would introduce a cycle: db -> ui -> api -> db')
  })

  it('rejects a longer cycle', () => {
    const withCache = ok(addEdge(ok(addComponent(base(), 'cache')), 'db', 'cache'))
    expect(error(addEdge(withCache, 'cache', 'ui'))).toBe(
      'edge "cache -> ui" would introduce a cycle: cache -> ui -> api -> db -> cache',
    )
  })

  it('does not block an unrelated edge when a disjoint cycle already exists', () => {
    const withLoop = ok(addComponent(base(), 'x'))
    withLoop.edges.push({ from: 'x', to: 'x' })
    const withCache = ok(addComponent(withLoop, 'cache'))
    expect(ok(addEdge(withCache, 'db', 'cache')).edges).toContainEqual({ from: 'db', to: 'cache' })
  })

  it('trims both ids', () => {
    expect(error(addEdge(base(), ' ui ', ' db '))).toBe('edge "ui -> db" is forbidden: no direct database access')
  })
})

describe('removeEdge', () => {
  it('removes the pair', () => {
    expect(ok(removeEdge(base(), 'ui', 'api')).edges).toEqual([{ from: 'api', to: 'db' }])
  })

  it('errors when the pair is not present', () => {
    expect(error(removeEdge(base(), 'db', 'ui'))).toBe('no edge "db -> ui"')
  })
})

describe('immutability', () => {
  it('never mutates the input architecture', () => {
    const a = base()
    const snapshot = structuredClone(a)

    addComponent(a, 'cache')
    renameComponent(a, 'db', 'store')
    setPurpose(a, 'api', 'new purpose')
    setOwns(a, 'api', ['x/**'])
    removeComponent(a, 'db')
    addEdge(a, 'ui', 'db')
    addEdge(a, 'db', 'ui')
    removeEdge(a, 'ui', 'api')

    expect(a).toEqual(snapshot)
  })
})

describe('round trip through graph.ts', () => {
  it('survives serialize and parse after a batch of edits', () => {
    const edited = ok(
      setOwns(
        ok(
          setPurpose(
            ok(addEdge(ok(addComponent(ok(removeComponent(ok(renameComponent(base(), 'db', 'store')), 'ui')), 'cache')), 'cache', 'store')),
            'cache',
            'keeps hot rows'
          )
        ),
        'cache',
        ['src/cache/**', 'src/cache/index.ts']
      )
    )

    expect(parse(serialize(edited))).toEqual(edited)
  })

  it('round trips every candidate the ops accept, and only those', () => {
    const candidates = [
      'a', 'a b', ' a ', '', '   ', 'a->b', '->', 'a\nb', '#a', '##a', '### a', '<!--a', 'owns:a',
      'a`b', 'a:b', '-a', '--a', 'a-b', '#', '`', ':', 'a\tb', 'a b', 'a\rb', '## a', 'a#b',
      '# a', '#a', '#### a', '### a', 'a -> b', 'owns: `x`', '- a -> b',
      'café', '数据库', '🙂', 'a​b', 'a b', '*', '**/*.ts', 'a|b', 'a<b>c'
    ]

    for (const c of candidates) {
      const added = addComponent(base(), c)
      if (added.ok) expect(parse(serialize(added.architecture))).toEqual(added.architecture)

      const described = setPurpose(base(), 'api', c)
      if (described.ok) expect(parse(serialize(described.architecture))).toEqual(described.architecture)

      const owned = setOwns(base(), 'api', [c])
      if (owned.ok) expect(parse(serialize(owned.architecture))).toEqual(owned.architecture)
    }
  })

  it('keeps accepted purposes safe even when the title is empty', () => {
    const untitled = { ...base(), title: '' }

    for (const c of ['# a', '#a', '#### a', 'plain', '#']) {
      const described = setPurpose(untitled, 'api', c)
      if (described.ok) {
        expect(parse(serialize(described.architecture)).components).toEqual(described.architecture.components)
      }
    }
  })

  it('survives awkward but accepted ids, purposes and globs', () => {
    const added = ok(addComponent(base(), 'weird-id_v2.0:-#x'))
    const described = ok(setPurpose(added, 'weird-id_v2.0:-#x', 'holds a - b : c > "d" ## e'))
    const owned = ok(setOwns(described, 'weird-id_v2.0:-#x', ['a b/**', 'x/*.ts', 'owns: src/**']))

    expect(parse(serialize(owned))).toEqual(owned)
  })
})

describe('selection follows an edit', () => {
  const selectable = (a: Architecture, id: string) => a.components.some((c) => c.id === id)

  it('lands on exactly the id the inspector will select', () => {
    const typed = '  cache  '
    const next = typed.trim()
    const result = renameComponent(base(), 'api', next)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(selectable(result.architecture, next)).toBe(true)
  })

  it('leaves the old id selectable when the rename collides', () => {
    const result = renameComponent(base(), 'api', 'db')
    expect(result.ok).toBe(false)
    expect(selectable(base(), 'api')).toBe(true)
  })

  it('leaves the old id selectable when the rename is empty', () => {
    const result = renameComponent(base(), 'api', '   ')
    expect(result.ok).toBe(false)
    expect(selectable(base(), 'api')).toBe(true)
  })

  it('keeps edges pointing at the renamed component', () => {
    const result = renameComponent(base(), 'api', 'gateway')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.architecture.edges).toEqual([
      { from: 'ui', to: 'gateway' },
      { from: 'gateway', to: 'db' }
    ])
    expect(result.architecture.forbidden[0]).toMatchObject({ from: 'ui', to: 'db' })
  })

  it('adds a component under a free placeholder id', () => {
    const taken = { ...base(), components: [...base().components, { id: 'component1', purpose: '', owns: [] }] }
    const free = (a: Architecture) => {
      let n = 1
      while (a.components.some((c) => c.id === `component${n}`)) n++
      return `component${n}`
    }
    const id = free(taken)
    expect(id).toBe('component2')
    const result = addComponent(taken, id)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(selectable(result.architecture, id)).toBe(true)
  })

  it('drops the selected id when the component is removed', () => {
    const result = removeComponent(base(), 'api')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(selectable(result.architecture, 'api')).toBe(false)
  })
})
