import { describe, expect, it } from 'vitest'

import { completions, definition, diagnostics, rename, renameTarget } from './features'

const h1 = '#'
const h2 = '##'
const h3 = '###'

const lines = [
  `${h1} Storefront`,
  '',
  'The storefront serves product pages and checkout.',
  '',
  `${h2} Components`,
  '',
  `${h3} api`,
  'Handles HTTP requests.',
  'owns: `src/api/**`',
  '',
  `${h3} ui`,
  'Renders pages.',
  '',
  `${h2} Dependencies`,
  '',
  '- ui -> api',
  '',
  `${h2} Forbidden`,
  '',
  '- api -> ui : the api never calls into the ui',
  '',
  `${h2} Packages`,
  '',
  '- express',
]

const fixture = lines.join('\n')

function edited(line: number, text: string): string {
  return lines.map((l, i) => (i === line ? text : l)).join('\n')
}

function at(line: number, character: number) {
  return { line, character }
}

function range(line: number, start: number, end: number) {
  return { start: { line, character: start }, end: { line, character: end } }
}

describe('diagnostics', () => {
  it('reports nothing for a well formed contract', () => {
    expect(diagnostics(fixture)).toEqual([])
  })

  it('reports nothing for an empty document', () => {
    expect(diagnostics('')).toEqual([])
  })

  it('reports nothing for a markdown file that is not a contract at all', () => {
    expect(diagnostics('# Notes\n\nSome prose\n\n- a shopping list\n')).toEqual([])
  })

  it('reports nothing for a contract with no components', () => {
    expect(diagnostics(`${h1} Empty\n\nNothing yet.\n\n${h2} Components\n\n${h2} Dependencies\n`)).toEqual([])
  })

  it('ranges a malformed owns entry over the whole entry', () => {
    const [problem] = diagnostics(edited(8, 'owns: src/api/**'))
    expect(problem?.range).toEqual(range(8, 0, 16))
    expect(problem?.message).toBe('malformed owns entry on line 9: owns: src/api/**')
  })

  it('ranges an owns entry with an unclosed backtick', () => {
    const [problem] = diagnostics(edited(8, 'owns: `src/api/**'))
    expect(problem?.range).toEqual(range(8, 0, 17))
  })

  it('ranges a malformed dependency over the whole line', () => {
    const [problem] = diagnostics(edited(15, '- ui => api'))
    expect(problem?.range).toEqual(range(15, 0, 11))
    expect(problem?.message).toBe('malformed dependency on line 16: - ui => api')
  })

  it('ranges a malformed forbidden entry over the whole line', () => {
    const [problem] = diagnostics(edited(19, '- api -> ui'))
    expect(problem?.range).toEqual(range(19, 0, 11))
    expect(problem?.message).toBe('malformed forbidden entry on line 20: - api -> ui')
  })

  it('ranges an unknown dependency source over the identifier only', () => {
    const [problem] = diagnostics(edited(15, '- ghost -> api'))
    expect(problem?.range).toEqual(range(15, 2, 7))
    expect(problem?.message).toBe('unknown component in dependency: ghost')
  })

  it('ranges an unknown dependency target over the identifier only', () => {
    const [problem] = diagnostics(edited(15, '- ui -> ghost'))
    expect(problem?.range).toEqual(range(15, 8, 13))
  })

  it('ranges an unknown forbidden target over the identifier only', () => {
    const [problem] = diagnostics(edited(19, '- api -> ghost : nope'))
    expect(problem?.range).toEqual(range(19, 9, 14))
    expect(problem?.message).toBe('unknown component in forbidden: ghost')
  })

  it('keeps the column of an indented dependency line', () => {
    const [problem] = diagnostics(edited(15, '    - ghost -> api'))
    expect(problem?.range).toEqual(range(15, 6, 11))
  })

  it('ranges a duplicate component over the repeated id', () => {
    const [problem] = diagnostics(edited(10, `${h3} api`))
    expect(problem?.range).toEqual(range(10, 4, 7))
    expect(problem?.message).toBe('duplicate component: api')
  })

  it('ranges an empty component id over the heading', () => {
    const [problem] = diagnostics(edited(10, h3))
    expect(problem?.range).toEqual(range(10, 0, 3))
    expect(problem?.message).toBe('component id cannot be empty')
  })

  it('ranges a component id containing a space over the id', () => {
    const [problem] = diagnostics(edited(10, `${h3} user interface`))
    expect(problem?.range).toEqual(range(10, 4, 18))
    expect(problem?.message).toMatch(/invalid component id "user interface"/)
  })

  it('keeps line and column on a document with windows line endings', () => {
    const [problem] = diagnostics(edited(15, '- ui -> ghost').replace(/\n/g, '\r\n'))
    expect(problem?.range).toEqual(range(15, 8, 13))
  })

  it('reports every problem in one pass, in document order', () => {
    const broken = edited(15, '- ghost -> api').split('\n')
    broken[19] = '- api -> phantom : nope'
    const found = diagnostics(broken.join('\n'))
    expect(found.map((d) => d.message)).toEqual([
      'unknown component in dependency: ghost',
      'unknown component in forbidden: phantom',
    ])
  })
})

describe('completions', () => {
  it('offers component ids on a dependency line', () => {
    expect(completions(fixture, at(15, 8)).map((c) => c.label)).toEqual(['api', 'ui'])
  })

  it('offers component ids before the reason on a forbidden line', () => {
    expect(completions(fixture, at(19, 9)).map((c) => c.label)).toEqual(['api', 'ui'])
  })

  it('offers nothing inside the reason of a forbidden line', () => {
    expect(completions(fixture, at(19, 20))).toEqual([])
  })

  it('offers nothing in the components section', () => {
    expect(completions(fixture, at(7, 3))).toEqual([])
  })

  it('offers nothing in the packages section', () => {
    expect(completions(fixture, at(23, 5))).toEqual([])
  })

  it('offers nothing past the end of the document', () => {
    expect(completions(fixture, at(400, 0))).toEqual([])
  })

  it('offers the components that parsed even when the document is broken', () => {
    expect(completions(edited(15, '- ghost -> api'), at(15, 4)).map((c) => c.label)).toEqual(['api', 'ui'])
  })
})

describe('definition', () => {
  it('jumps from a dependency source to its heading', () => {
    expect(definition(fixture, at(15, 3))).toEqual(range(10, 4, 6))
  })

  it('jumps from a dependency target to its heading', () => {
    expect(definition(fixture, at(15, 9))).toEqual(range(6, 4, 7))
  })

  it('jumps from a forbidden endpoint to its heading', () => {
    expect(definition(fixture, at(19, 10))).toEqual(range(10, 4, 6))
  })

  it('returns nothing for an endpoint no component defines', () => {
    expect(definition(edited(15, '- ghost -> api'), at(15, 3))).toBeUndefined()
  })

  it('returns nothing away from any identifier', () => {
    expect(definition(fixture, at(2, 4))).toBeUndefined()
  })
})

describe('rename', () => {
  it('rewrites the heading and every reference', () => {
    const result = rename(fixture, at(6, 5), 'gateway')
    expect(result).toEqual({
      edits: [
        { range: range(6, 4, 7), newText: 'gateway' },
        { range: range(15, 8, 11), newText: 'gateway' },
        { range: range(19, 2, 5), newText: 'gateway' },
      ],
    })
  })

  it('rewrites from a reference position too', () => {
    const result = rename(fixture, at(15, 3), 'web')
    expect(result).toEqual({
      edits: [
        { range: range(10, 4, 6), newText: 'web' },
        { range: range(15, 2, 4), newText: 'web' },
        { range: range(19, 9, 11), newText: 'web' },
      ],
    })
  })

  it('rewrites the layout hint as well', () => {
    const withLayout = `${fixture}\n\n<!-- architect:layout\napi: 10,20\nui: 30,40\n-->\n`
    const result = rename(withLayout, at(6, 5), 'gateway')
    expect('edits' in result && result.edits).toContainEqual({ range: range(26, 0, 3), newText: 'gateway' })
  })

  it('refuses a new id with a space', () => {
    expect(rename(fixture, at(6, 5), 'api gateway')).toEqual({
      error: 'invalid component id "api gateway": ids must be one word with no spaces and no "->"',
    })
  })

  it('refuses an empty new id', () => {
    expect(rename(fixture, at(6, 5), '  ')).toEqual({ error: 'component id cannot be empty' })
  })

  it('refuses a new id another component already uses', () => {
    expect(rename(fixture, at(6, 5), 'ui')).toEqual({ error: 'duplicate component: ui' })
  })

  it('refuses a position that names no component', () => {
    expect(rename(fixture, at(2, 4), 'gateway')).toEqual({ error: 'not a component' })
  })
})

describe('renameTarget', () => {
  it('spans the identifier under the cursor', () => {
    expect(renameTarget(fixture, at(15, 9))).toEqual({ range: range(15, 8, 11), placeholder: 'api' })
  })

  it('refuses an endpoint no component defines', () => {
    expect(renameTarget(edited(15, '- ghost -> api'), at(15, 3))).toBeUndefined()
  })

  it('refuses a position away from any identifier', () => {
    expect(renameTarget(fixture, at(2, 4))).toBeUndefined()
  })
})
