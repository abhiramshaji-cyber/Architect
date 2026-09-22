import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { apply, check, ownership, parse, serialize } from './graph'
import { findCycle } from '../../shared/cycle'
import type { Architecture } from '../../shared/types'

const h1 = '#'
const h2 = '##'
const h3 = '###'

const fixture = `${h1} Storefront

The storefront serves product pages and checkout.

${h2} Components

${h3} api
Handles HTTP requests.
owns: \`src/api/**\`
owns: \`src/api-legacy/**\`

${h3} db
Persists orders.
owns: \`src/db/**\`

${h3} ui
Renders pages.
owns: \`src/ui/**\`

${h2} Dependencies

- ui -> api
- api -> db

${h2} Forbidden

- ui -> db : bypasses the api layer

${h2} Packages

- express
- react
`

describe('parse', () => {
  it('reads title and summary', () => {
    const arch = parse(fixture)
    expect(arch.title).toBe('Storefront')
    expect(arch.summary).toBe('The storefront serves product pages and checkout.')
  })

  it('reads components with purpose and owns', () => {
    const arch = parse(fixture)
    expect(arch.components).toEqual([
      { id: 'api', purpose: 'Handles HTTP requests.', owns: ['src/api/**', 'src/api-legacy/**'] },
      { id: 'db', purpose: 'Persists orders.', owns: ['src/db/**'] },
      { id: 'ui', purpose: 'Renders pages.', owns: ['src/ui/**'] },
    ])
  })

  it('parses zero owns lines as an empty array', () => {
    const noOwns = fixture.replace(`${h3} db\nPersists orders.\nowns: \`src/db/**\``, `${h3} db\nPersists orders.`)
    const arch = parse(noOwns)
    expect(arch.components.find((c) => c.id === 'db')?.owns).toEqual([])
  })

  it('reads dependencies as edges', () => {
    const arch = parse(fixture)
    expect(arch.edges).toEqual([
      { from: 'ui', to: 'api' },
      { from: 'api', to: 'db' },
    ])
  })

  it('reads forbidden entries with reason', () => {
    const arch = parse(fixture)
    expect(arch.forbidden).toEqual([
      { from: 'ui', to: 'db', reason: 'bypasses the api layer' },
    ])
  })

  it('reads packages', () => {
    const arch = parse(fixture)
    expect(arch.packages).toEqual(['express', 'react'])
  })

  it('throws on an edge naming a component that does not exist', () => {
    const bad = fixture.replace('- ui -> api', '- ui -> ghost')
    expect(() => parse(bad)).toThrow(/ghost/)
  })

  it('throws on a forbidden entry naming a component that does not exist', () => {
    const bad = fixture.replace('- ui -> db : bypasses the api layer', '- ui -> ghost : bad')
    expect(() => parse(bad)).toThrow(/ghost/)
  })

  it('throws on a dependency line that does not match, naming the text and document line', () => {
    const bad = fixture.replace('- ui -> api', '- ui \u2192 api')
    expect(() => parse(bad)).toThrow(/line 22/)
    expect(() => parse(bad)).toThrow(/ui \u2192 api/)
  })

  it('throws on a forbidden line that does not match, naming the text and document line', () => {
    const bad = fixture.replace('- ui -> db : bypasses the api layer', '- ui -> db - bypasses the api layer')
    expect(() => parse(bad)).toThrow(/line 27/)
    expect(() => parse(bad)).toThrow(/bypasses the api layer/)
  })

  it('throws on an owns line that does not match, naming the text and document line', () => {
    const bad = fixture.replace('owns: `src/api/**`', 'owns: src/api/**')
    expect(() => parse(bad)).toThrow(/line 9/)
    expect(() => parse(bad)).toThrow(/owns: src\/api\/\*\*/)
  })

  it('throws on an owns line with unclosed backtick', () => {
    const bad = fixture.replace('owns: `src/api/**`', 'owns: `src/api/**')
    expect(() => parse(bad)).toThrow(/line 9/)
    expect(() => parse(bad)).toThrow(/malformed owns entry/)
  })

  it('throws on an owns line with empty backticks', () => {
    const bad = fixture.replace('owns: `src/api/**`', 'owns: ``')
    expect(() => parse(bad)).toThrow(/line 9/)
    expect(() => parse(bad)).toThrow(/malformed owns entry/)
  })

  it('reports the document line number when the malformed line is the last line of the file', () => {
    const tail = `${h1} T\n\nS.\n\n${h2} Components\n\n${h3} a\nDoes a.\n\n${h2} Dependencies\n\n- a -> a\n- a => a`
    expect(() => parse(tail)).toThrow(/line 13/)
  })

  it('accepts blank lines and surrounding whitespace inside a section', () => {
    const spaced = fixture.replace('- api -> db', '\n   - api -> db   \n')
    expect(parse(spaced).edges).toEqual(parse(fixture).edges)
  })

  it('accepts an indented comment line inside a section', () => {
    const commented = fixture.replace('- api -> db', '  <!-- the api owns persistence -->\n- api -> db')
    expect(parse(commented).edges).toEqual(parse(fixture).edges)
  })

  it('parses a document with CRLF line endings', () => {
    expect(parse(fixture.replace(/\n/g, '\r\n'))).toEqual(parse(fixture))
  })

  it('ignores lines that sit before the first section heading', () => {
    const preamble = fixture.replace(`${h2} Components`, `- stray -> line\n\n${h2} Components`)
    expect(parse(preamble)).toEqual(parse(fixture))
  })

  it('ignores the body of a heading it does not know', () => {
    const extra = `${fixture}\n${h2} Notes\n\n- freeform note, not an edge\n`
    expect(parse(extra)).toEqual(parse(fixture))
  })

  it('treats a missing section as empty rather than malformed', () => {
    const partial = `${h1} T\n\nS.\n\n${h2} Components\n\n${h3} a\nDoes a.\n`
    const arch = parse(partial)
    expect(arch.edges).toEqual([])
    expect(arch.forbidden).toEqual([])
    expect(arch.packages).toEqual([])
  })

  it('parses the architect.md of this repository', () => {
    const doc = readFileSync(fileURLToPath(new URL('../../architect.md', import.meta.url)), 'utf8')
    const arch = parse(doc)
    expect(arch.components.map((c) => c.id)).toContain('graph')
    expect(arch.edges).toContainEqual({ from: 'daemon', to: 'graph' })
    expect(arch.forbidden.map((f) => `${f.from}->${f.to}`)).toContain('canvas->pty')
    expect(arch.forbidden.length).toBe(7)
  })

  it('throws on a duplicate component id', () => {
    const bad = fixture.replace(
      `${h3} ui\nRenders pages.\nowns: \`src/ui/**\``,
      `${h3} ui\nRenders pages.\nowns: \`src/ui/**\`\n\n${h3} ui\nDuplicate.\nowns: \`src/dup/**\``,
    )
    expect(() => parse(bad)).toThrow(/ui/)
  })

  it('throws on an empty component id', () => {
    const bad = fixture.replace(`${h3} ui`, `${h3} `)
    expect(() => parse(bad)).toThrow(/empty/)
  })

  it('throws on a component id with whitespace', () => {
    const bad = fixture.replace(`${h3} ui`, `${h3} user service`)
    expect(() => parse(bad)).toThrow(/invalid component id/)
  })

  it('throws on a component id containing ->', () => {
    const bad = fixture.replace(`${h3} ui`, `${h3} ui->db`)
    expect(() => parse(bad)).toThrow(/invalid component id/)
  })
})

describe('serialize', () => {
  it('round trips through parse', () => {
    const arch = parse(fixture)
    const again = parse(serialize(arch))
    expect(again).toEqual(arch)
  })

  it('round trips after the last component is deleted', () => {
    const emptied = { ...parse(fixture), components: [], edges: [], forbidden: [] }
    expect(parse(serialize(emptied))).toEqual(emptied)
  })
})

describe('check', () => {
  const arch = parse(fixture)

  it('returns allowed when an edge matches', () => {
    expect(check(arch, 'ui', 'api')).toEqual({ status: 'allowed' })
  })

  it('returns forbidden when a forbidden entry matches', () => {
    expect(check(arch, 'ui', 'db')).toEqual({ status: 'forbidden', reason: 'bypasses the api layer' })
  })

  it('returns undrawn-edge when both components exist but no edge is drawn', () => {
    const withCache = parse(fixture.replace('### ui', '### cache\nCaches responses.\n\n### ui'))
    expect(check(withCache, 'cache', 'ui')).toEqual({ status: 'undrawn-edge' })
  })

  it('checks forbidden before allowed', () => {
    const both = parse(
      fixture
        .replace('- ui -> db : bypasses the api layer', '- ui -> db : bypasses the api layer\n- ui -> api : also forbidden')
        .replace('- ui -> api\n', '- ui -> api\n- ui -> db\n'),
    )
    expect(check(both, 'ui', 'api')).toEqual({ status: 'forbidden', reason: 'also forbidden' })
  })

  it('returns unknown-component naming the missing id, never allowed', () => {
    expect(check(arch, 'ghost', 'api')).toEqual({ status: 'unknown-component', ids: ['ghost'] })
  })

  it('names both ids when neither component exists', () => {
    expect(check(arch, 'ghost', 'phantom')).toEqual({ status: 'unknown-component', ids: ['ghost', 'phantom'] })
  })

  it('dedupes when the same missing id is used on both sides', () => {
    expect(check(arch, 'ghost', 'ghost')).toEqual({ status: 'unknown-component', ids: ['ghost'] })
  })
})

function chain(edges: { from: string; to: string }[]): Architecture {
  const ids = [...new Set(edges.flatMap((e) => [e.from, e.to]))]
  return {
    title: 'Chain',
    summary: '',
    components: ids.map((id) => ({ id, purpose: '', owns: [] })),
    edges,
    forbidden: [],
    packages: [],
  }
}

describe('cycle enforcement', () => {
  it('check flags a self edge as a cycle', () => {
    const arch = chain([{ from: 'a', to: 'b' }])
    expect(check(arch, 'a', 'a')).toEqual({ status: 'cycle', path: ['a', 'a'] })
  })

  it('check flags a two node cycle', () => {
    const arch = chain([{ from: 'a', to: 'b' }])
    expect(check(arch, 'b', 'a')).toEqual({ status: 'cycle', path: ['b', 'a', 'b'] })
  })

  it('check flags a longer cycle', () => {
    const arch = chain([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }])
    expect(check(arch, 'd', 'a')).toEqual({ status: 'cycle', path: ['d', 'a', 'b', 'c', 'd'] })
  })

  it('check does not flag an unrelated edge when a disjoint cycle already exists', () => {
    const arch = chain([{ from: 'x', to: 'x' }, { from: 'a', to: 'b' }])
    expect(check(arch, 'b', 'x')).toEqual({ status: 'undrawn-edge' })
  })

  it('check does not flag a new edge shortcutting an existing forward chain', () => {
    const arch = chain([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }])
    expect(check(arch, 'a', 'c')).toEqual({ status: 'undrawn-edge' })
  })

  it('apply throws on a self edge proposal', () => {
    const arch = chain([{ from: 'a', to: 'b' }])
    expect(() => apply(arch, { kind: 'edge', from: 'a', to: 'a' })).toThrow(/cycle/)
  })

  it('apply throws on a two node cycle proposal', () => {
    const arch = chain([{ from: 'a', to: 'b' }])
    expect(() => apply(arch, { kind: 'edge', from: 'b', to: 'a' })).toThrow(/cycle/)
  })

  it('apply throws on a longer cycle proposal', () => {
    const arch = chain([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }])
    expect(() => apply(arch, { kind: 'edge', from: 'd', to: 'a' })).toThrow(/d -> a -> b -> c -> d/)
  })

  it('apply allows an edge disjoint from several existing cycles', () => {
    const arch = chain([
      { from: 'x', to: 'x' },
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
      { from: 'p', to: 'q' },
    ])
    const result = apply(arch, { kind: 'edge', from: 'q', to: 'x' })
    expect(result.edges).toContainEqual({ from: 'q', to: 'x' })
  })

  it('a proposal reintroducing an edge already present in a stored cycle is a no op, not a throw', () => {
    const arch = chain([{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])
    const result = apply(arch, { kind: 'edge', from: 'a', to: 'b' })
    expect(result.edges).toEqual(arch.edges)
  })

  it('loading an architecture that already contains a cycle does not throw', () => {
    expect(() => chain([{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])).not.toThrow()
    const arch = chain([{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])
    expect(() => check(arch, 'a', 'b')).not.toThrow()
  })

  it('findCycle returns null when no cycle would form', () => {
    expect(findCycle([{ from: 'a', to: 'b' }], 'b', 'c')).toBeNull()
  })
})

describe('apply', () => {
  const arch = parse(fixture)

  it('is pure and returns a new object', () => {
    const proposal = { kind: 'edge' as const, from: 'ui', to: 'db' }
    const result = apply(arch, proposal)
    expect(result).not.toBe(arch)
    expect(arch.edges).toEqual([
      { from: 'ui', to: 'api' },
      { from: 'api', to: 'db' },
    ])
    expect(result.edges).toContainEqual({ from: 'ui', to: 'db' })
  })

  it('adds a new component', () => {
    const proposal = { kind: 'component' as const, id: 'cache', purpose: 'Caches responses.', owns: ['src/cache/**'] }
    const result = apply(arch, proposal)
    const added = result.components.find((c) => c.id === 'cache')
    expect(added).toEqual({ id: 'cache', purpose: 'Caches responses.', owns: ['src/cache/**'] })
  })

  it('is a no op for a duplicate component', () => {
    const proposal = { kind: 'component' as const, id: 'api', purpose: 'Different.', owns: ['src/x/**'] }
    const result = apply(arch, proposal)
    expect(result.components).toEqual(arch.components)
  })

  it('is a no op for a duplicate edge', () => {
    const proposal = { kind: 'edge' as const, from: 'ui', to: 'api' }
    const result = apply(arch, proposal)
    expect(result.edges).toEqual(arch.edges)
  })

  it('is a no op for a duplicate package', () => {
    const withPackage = apply(arch, { kind: 'package' as const, name: 'express', component: 'api' })
    expect(withPackage.packages).toEqual(arch.packages)
  })

  it('throws when a package proposal names a component that does not exist', () => {
    const proposal = { kind: 'package' as const, name: 'lodash', component: 'ghost' }
    expect(() => apply(arch, proposal)).toThrow(/ghost/)
  })

  it('appends a file path to the named component owns array', () => {
    const proposal = { kind: 'file' as const, path: 'src/api/routes.ts', component: 'api' }
    const result = apply(arch, proposal)
    const api = result.components.find((c) => c.id === 'api')
    expect(api?.owns).toEqual(['src/api/**', 'src/api-legacy/**', 'src/api/routes.ts'])
  })

  it('is a no op when the file path is already in that component owns array', () => {
    const proposal = { kind: 'file' as const, path: 'src/api/**', component: 'api' }
    const result = apply(arch, proposal)
    expect(result.components).toEqual(arch.components)
  })

  it('throws when a file proposal names a component that does not exist', () => {
    const proposal = { kind: 'file' as const, path: 'src/x.ts', component: 'ghost' }
    expect(() => apply(arch, proposal)).toThrow(/ghost/)
  })

  it('does not mutate the input architecture when applying a file proposal', () => {
    const before = JSON.parse(JSON.stringify(arch))
    apply(arch, { kind: 'file' as const, path: 'src/api/new.ts', component: 'api' })
    expect(arch).toEqual(before)
  })

  it('removes a component along with every edge and forbidden rule touching it', () => {
    const proposal = { kind: 'remove_component' as const, id: 'api' }
    const result = apply(arch, proposal)
    expect(result.components.map((c) => c.id)).toEqual(['db', 'ui'])
    expect(result.edges).toEqual([])
    expect(result.forbidden).toEqual([{ from: 'ui', to: 'db', reason: 'bypasses the api layer' }])
  })

  it('leaves edges and forbidden rules untouched between components that were not removed', () => {
    const proposal = { kind: 'remove_component' as const, id: 'db' }
    const result = apply(arch, proposal)
    expect(result.edges).toEqual([{ from: 'ui', to: 'api' }])
    expect(result.forbidden).toEqual([])
  })

  it('throws when removing a component that does not exist', () => {
    const proposal = { kind: 'remove_component' as const, id: 'ghost' }
    expect(() => apply(arch, proposal)).toThrow(/ghost/)
  })

  it('does not mutate the input architecture when removing a component', () => {
    const before = JSON.parse(JSON.stringify(arch))
    apply(arch, { kind: 'remove_component' as const, id: 'api' })
    expect(arch).toEqual(before)
  })

  it('removes the last component leaving an empty architecture', () => {
    let solo = apply(arch, { kind: 'remove_component' as const, id: 'api' })
    solo = apply(solo, { kind: 'remove_component' as const, id: 'db' })
    solo = apply(solo, { kind: 'remove_component' as const, id: 'ui' })
    expect(solo.components).toEqual([])
    expect(solo.edges).toEqual([])
    expect(solo.forbidden).toEqual([])
  })
})

describe('layout', () => {
  const block = (...entries: string[]) => `${fixture}\n<!-- architect:layout\n${entries.join('\n')}\n-->\n`

  it('reads stored positions as a layout hint', () => {
    expect(parse(block('api: 100,200', 'db: 300,200', 'ui: 100,50')).layout).toEqual({
      api: { x: 100, y: 200 },
      db: { x: 300, y: 200 },
      ui: { x: 100, y: 50 },
    })
  })

  it('leaves the rest of the document untouched by the block', () => {
    const arch = parse(block('api: 100,200'))
    const { layout, ...rest } = arch
    expect(rest).toEqual(parse(fixture))
  })

  it('reports no layout when there is no block', () => {
    expect(parse(fixture).layout).toBeUndefined()
    expect(serialize(parse(fixture))).toBe(serialize(parse(fixture)))
    expect(serialize(parse(fixture))).not.toMatch(/architect:layout/)
  })

  it('writes positions in component order', () => {
    const arch = { ...parse(fixture), layout: { ui: { x: 1, y: 2 }, api: { x: 3, y: 4 } } }
    expect(serialize(arch)).toMatch(/<!-- architect:layout\napi: 3,4\nui: 1,2\n-->$/)
  })

  it('round trips positions through serialize and parse', () => {
    const arch = parse(block('api: 100.5,200', 'db: 300,0', 'ui: 0,50'))
    expect(parse(serialize(arch))).toEqual(arch)
  })

  it('serializes a document with a layout block byte identically', () => {
    const document = serialize(parse(block('api: 100,200', 'db: 300,200', 'ui: 100,50')))
    expect(serialize(parse(document))).toBe(document)
  })

  it('serializes a document with no layout block byte identically', () => {
    const document = serialize(parse(fixture))
    expect(serialize(parse(document))).toBe(document)
  })

  it('keeps positions through apply', () => {
    const arch = parse(block('api: 100,200'))
    const next = apply(arch, { kind: 'component', id: 'cache', purpose: 'Caches.', owns: [] })
    expect(next.layout).toEqual({ api: { x: 100, y: 200 } })
  })

  it('drops positions for components that no longer exist', () => {
    const arch = parse(block('api: 100,200', 'ghost: 10,10'))
    expect(arch.layout).toEqual({ api: { x: 100, y: 200 } })
    expect(serialize(arch)).not.toMatch(/ghost/)
  })

  it('keeps the positions it can read when only some components are stored', () => {
    expect(parse(block('api: 100,200')).layout).toEqual({ api: { x: 100, y: 200 } })
  })

  it('keeps the first entry when a component is stored twice', () => {
    expect(parse(block('api: 1,2', 'api: 9,9')).layout).toEqual({ api: { x: 1, y: 2 } })
  })

  it.each([
    ['not a number', 'api: x,y'],
    ['NaN', 'api: NaN,NaN'],
    ['Infinity', 'api: Infinity,0'],
    ['negative', 'api: -10,20'],
    ['empty coordinates', 'api: ,'],
    ['a missing coordinate', 'api: 100'],
    ['too many coordinates', 'api: 1,2,3'],
    ['no separator', 'api 100 200'],
    ['an empty id', ': 100,200'],
    ['prose', 'this block was written by hand and means nothing'],
  ])('falls back to auto layout on %s', (_name, entry) => {
    const arch = parse(block(entry))
    expect(arch.layout).toBeUndefined()
    expect(arch.components).toEqual(parse(fixture).components)
  })

  it('reads the valid entries of a partly corrupt block', () => {
    expect(parse(block('api: 1,2', 'db: oops', 'ui: 3,4')).layout).toEqual({
      api: { x: 1, y: 2 },
      ui: { x: 3, y: 4 },
    })
  })

  it('does not throw on an unterminated block', () => {
    const open = `${fixture}\n<!-- architect:layout\napi: 1,2\n`
    expect(parse(open).layout).toEqual({ api: { x: 1, y: 2 } })
  })

  it('does not throw on an enormous block', () => {
    const many = Array.from({ length: 50_000 }, (_, i) => `c${i}: ${i},${i}`)
    const arch = parse(block(...many, 'api: 7,8'))
    expect(arch.layout).toEqual({ api: { x: 7, y: 8 } })
  })

  it('reads the last block when the document carries more than one', () => {
    const twice = `${block('api: 1,2')}\n<!-- architect:layout\napi: 8,9\n-->\n`
    expect(parse(twice).layout).toEqual({ api: { x: 8, y: 9 } })
  })

  it('writes no block when every stored position is unusable', () => {
    const arch = { ...parse(fixture), layout: { api: { x: NaN, y: 0 }, db: 'here', ui: null } }
    expect(serialize(arch as never)).not.toMatch(/architect:layout/)
  })

  it('writes nothing for a layout that is not a record of points', () => {
    for (const layout of [null, 'somewhere', 42, ['api']]) {
      expect(serialize({ ...parse(fixture), layout } as never)).not.toMatch(/architect:layout/)
    }
  })

  it('treats a component named after an object prototype key as any other', () => {
    const proto = fixture.replace(`${h3} ui`, `${h3} toString`).replace(/\bui\b/g, 'toString')
    const arch = parse(`${proto}\n<!-- architect:layout\ntoString: 5,6\n-->\n`)
    expect(arch.layout).toEqual({ toString: { x: 5, y: 6 } })
    expect(parse(serialize(arch))).toEqual(arch)
  })

  it('reads a layout block written with CRLF line endings', () => {
    const crlf = block('api: 100,200').replace(/\n/g, '\r\n')
    expect(parse(crlf).layout).toEqual({ api: { x: 100, y: 200 } })
  })

  it('does not let the block reach the packages section', () => {
    expect(parse(block('api: 100,200')).packages).toEqual(['express', 'react'])
  })

  it('does not read the block as a malformed dependency', () => {
    const inside = `${h1} T\n\nS.\n\n${h2} Components\n\n${h3} a\nDoes a.\n\n${h2} Dependencies\n\n- a -> a\n\n<!-- architect:layout\na: 1,2\n-->\n`
    expect(() => parse(inside)).not.toThrow()
    expect(parse(inside).layout).toEqual({ a: { x: 1, y: 2 } })
  })
})

function component(id: string, ...owns: string[]) {
  return { id, purpose: '', owns }
}

describe('ownership', () => {
  it('leaves every file unowned when no component declares a glob', () => {
    const result = ownership(['a.ts', 'b.ts'], [component('one'), component('two')])

    expect(result.owned).toEqual([])
    expect(result.multi).toEqual([])
    expect(result.dead).toEqual([])
    expect(result.unowned).toEqual(['a.ts', 'b.ts'])
  })

  it('classifies nothing when there are no files', () => {
    const result = ownership([], [component('one', 'src/**')])

    expect(result.owned).toEqual([])
    expect(result.unowned).toEqual([])
    expect(result.multi).toEqual([])
    expect(result.dead).toEqual([{ component: 'one', pattern: 'src/**' }])
  })

  it('counts a file matched twice by one component only once', () => {
    const result = ownership(['src/a.ts'], [component('one', 'src/**', 'src/*.ts', '**/a.ts')])

    expect(result.owned).toEqual([{ path: 'src/a.ts', owner: 'one' }])
    expect(result.multi).toEqual([])
    expect(result.dead).toEqual([])
  })

  it('reports a file claimed by two different components', () => {
    const result = ownership(['src/a.ts', 'src/b.ts'], [component('one', 'src/**'), component('two', 'src/a.ts')])

    expect(result.multi).toEqual([{ path: 'src/a.ts', owners: ['one', 'two'] }])
    expect(result.owned).toEqual([{ path: 'src/b.ts', owner: 'one' }])
    expect(result.unowned).toEqual([])
  })

  it('sorts multi owners deterministically whatever the component order', () => {
    const files = ['src/a.ts']
    const a = ownership(files, [component('zed', 'src/**'), component('alf', 'src/**')])
    const b = ownership(files, [component('alf', 'src/**'), component('zed', 'src/**')])

    expect(a.multi).toEqual([{ path: 'src/a.ts', owners: ['alf', 'zed'] }])
    expect(a).toEqual(b)
  })

  it('reports a glob that matches nothing as dead, in its declared form', () => {
    const result = ownership(['src/a.ts'], [component('one', 'src/**', './does/not/exist/**')])

    expect(result.dead).toEqual([{ component: 'one', pattern: './does/not/exist/**' }])
  })

  it('reports an empty pattern as dead and lets it own nothing', () => {
    const result = ownership(['src/a.ts'], [component('one', '')])

    expect(result.dead).toEqual([{ component: 'one', pattern: '' }])
    expect(result.unowned).toEqual(['src/a.ts'])
  })

  it('reports a pattern escaping the root as dead', () => {
    const result = ownership(['src/a.ts'], [component('one', '../outside/**')])

    expect(result.dead).toEqual([{ component: 'one', pattern: '../outside/**' }])
    expect(result.unowned).toEqual(['src/a.ts'])
  })

  it('reports a malformed pattern as dead instead of throwing', () => {
    const result = ownership(['src/a.ts'], [component('one', 'src/[a-')])

    expect(result.dead).toEqual([{ component: 'one', pattern: 'src/[a-' }])
  })

  it('does not report the same canonical pattern twice', () => {
    const result = ownership([], [component('one', 'nope/**', './nope/**', 'nope//**')])

    expect(result.dead).toEqual([{ component: 'one', pattern: 'nope/**' }])
  })

  it('normalises leading ./, doubled slashes, a root slash and backslashes on both sides', () => {
    const files = ['./src/a.ts', 'src\\deep\\b.ts', 'src//c.ts']
    const result = ownership(files, [component('one', './src/**'), component('two', '/nope/**')])

    expect(result.owned).toEqual([
      { path: 'src/a.ts', owner: 'one' },
      { path: 'src/c.ts', owner: 'one' },
      { path: 'src/deep/b.ts', owner: 'one' },
    ])
    expect(result.dead).toEqual([{ component: 'two', pattern: '/nope/**' }])
  })

  it('treats a root anchored file path as root relative and an out of tree absolute path as foreign', () => {
    const result = ownership(['/src/a.ts', '/Users/dev/elsewhere/b.ts'], [component('one', 'src/**')])

    expect(result.owned).toEqual([{ path: 'src/a.ts', owner: 'one' }])
    expect(result.unowned).toEqual(['Users/dev/elsewhere/b.ts'])
  })

  it('stays total when two components share an id', () => {
    const result = ownership(['src/a.ts'], [component('one', 'src/**'), component('one', 'src/a.ts')])

    expect(result.owned).toEqual([{ path: 'src/a.ts', owner: 'one' }])
    expect(result.multi).toEqual([])
  })

  it('treats a root anchored pattern as root relative', () => {
    const result = ownership(['src/a.ts'], [component('one', '/src/**')])

    expect(result.owned).toEqual([{ path: 'src/a.ts', owner: 'one' }])
  })

  it('collapses a path listed twice in different spellings', () => {
    const result = ownership(['src/a.ts', './src/a.ts', 'src\\a.ts'], [component('one', 'src/**')])

    expect(result.owned).toEqual([{ path: 'src/a.ts', owner: 'one' }])
  })

  it('matches star, question mark, braces and nested globstars', () => {
    const files = ['src/a.ts', 'src/deep/deeper/b.tsx', 'docs/x.md', 'a.ts']
    const result = ownership(files, [component('one', 'src/**/*.{ts,tsx}'), component('two', 'docs/?.md')])

    expect(result.owned).toEqual([
      { path: 'docs/x.md', owner: 'two' },
      { path: 'src/a.ts', owner: 'one' },
      { path: 'src/deep/deeper/b.tsx', owner: 'one' },
    ])
    expect(result.unowned).toEqual(['a.ts'])
  })

  it('matches dotfiles under a globstar', () => {
    const result = ownership(['src/.keep'], [component('one', 'src/**')])

    expect(result.owned).toEqual([{ path: 'src/.keep', owner: 'one' }])
  })

  it('honours a negated pattern', () => {
    const result = ownership(['src/a.ts', 'src/b.ts'], [component('one', '!src/a.ts')])

    expect(result.owned).toEqual([{ path: 'src/b.ts', owner: 'one' }])
    expect(result.unowned).toEqual(['src/a.ts'])
  })

  it('matches case sensitively on every platform', () => {
    const result = ownership(['src/App.tsx'], [component('one', 'src/app.tsx')])

    expect(result.unowned).toEqual(['src/App.tsx'])
    expect(result.dead).toEqual([{ component: 'one', pattern: 'src/app.tsx' }])
  })

  it('is pure, returning an equal result for a repeated call and mutating no input', () => {
    const files = ['src/a.ts', 'b.ts']
    const components = [component('one', 'src/**')]

    expect(ownership(files, components)).toEqual(ownership(files, components))
    expect(files).toEqual(['src/a.ts', 'b.ts'])
    expect(components).toEqual([{ id: 'one', purpose: '', owns: ['src/**'] }])
  })

  it('classifies every file into exactly one bucket', () => {
    const files = ['src/a.ts', 'src/b.ts', 'docs/c.md']
    const result = ownership(files, [component('one', 'src/**'), component('two', 'src/a.ts')])

    const seen = [...result.owned.map((o) => o.path), ...result.unowned, ...result.multi.map((m) => m.path)]
    expect(seen.sort()).toEqual([...files].sort())
  })
})
