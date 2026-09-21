import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { apply, check, parse, serialize } from './graph'

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
    const doc = readFileSync(fileURLToPath(new URL('../architect.md', import.meta.url)), 'utf8')
    const arch = parse(doc)
    expect(arch.components.map((c) => c.id)).toContain('graph')
    expect(arch.edges).toContainEqual({ from: 'daemon', to: 'graph' })
    expect(arch.forbidden.length).toBe(4)
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
})

describe('check', () => {
  const arch = parse(fixture)

  it('returns allowed when an edge matches', () => {
    expect(check(arch, 'ui', 'api')).toEqual({ status: 'allowed' })
  })

  it('returns forbidden when a forbidden entry matches', () => {
    expect(check(arch, 'ui', 'db')).toEqual({ status: 'forbidden', reason: 'bypasses the api layer' })
  })

  it('returns unknown when neither matches', () => {
    expect(check(arch, 'api', 'ui')).toEqual({ status: 'unknown' })
  })

  it('checks forbidden before allowed', () => {
    const both = parse(
      fixture
        .replace('- ui -> db : bypasses the api layer', '- ui -> db : bypasses the api layer\n- ui -> api : also forbidden')
        .replace('- ui -> api\n', '- ui -> api\n- ui -> db\n'),
    )
    expect(check(both, 'ui', 'api')).toEqual({ status: 'forbidden', reason: 'also forbidden' })
  })

  it('returns unknown for an unknown component id, never allowed', () => {
    expect(check(arch, 'ghost', 'api')).toEqual({ status: 'unknown' })
  })
})

describe('apply', () => {
  const arch = parse(fixture)

  it('is pure and returns a new object', () => {
    const proposal = { kind: 'edge' as const, from: 'db', to: 'ui' }
    const result = apply(arch, proposal)
    expect(result).not.toBe(arch)
    expect(arch.edges).toEqual([
      { from: 'ui', to: 'api' },
      { from: 'api', to: 'db' },
    ])
    expect(result.edges).toContainEqual({ from: 'db', to: 'ui' })
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
