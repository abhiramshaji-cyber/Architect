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

  it('ignores a leftover layout block from before the migration', () => {
    const withLayout = `${fixture}\n<!-- architect:layout\napi: 100,200\ndb: 300,200\nui: 100,50\n-->\n`
    const arch = parse(withLayout)
    expect(arch).toEqual(parse(fixture))
    expect(serialize(arch)).not.toMatch(/architect:layout/)
  })

  it('throws on an edge naming a component that does not exist', () => {
    const bad = fixture.replace('- ui -> api', '- ui -> ghost')
    expect(() => parse(bad)).toThrow(/ghost/)
  })

  it('throws on a forbidden entry naming a component that does not exist', () => {
    const bad = fixture.replace('- ui -> db : bypasses the api layer', '- ui -> ghost : bad')
    expect(() => parse(bad)).toThrow(/ghost/)
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
