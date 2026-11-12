import { describe, expect, it } from 'vitest'
import type { Architecture, Component } from '../../shared/types'
import { MARKER, renderAgents } from './render'

const component = (id: string, owns: string[], purpose = `${id} things`): Component => ({ id, purpose, owns })

function architecture(components: Component[], extra: Partial<Architecture> = {}): Architecture {
  return { title: 'T', summary: 'S', components, edges: [], forbidden: [], packages: [], ...extra }
}

const folders = (arch: Architecture) => Object.fromEntries(renderAgents(arch).placed.map((p) => [p.component, p.folder]))

describe('renderAgents placement', () => {
  it('places each component at the folder its globs share when it owns that whole folder', () => {
    const arch = architecture([
      component('api', ['src/api/**']),
      component('db', ['src/db/**', 'src/db/migrate/*.sql', '!other/**']),
      component('ui', ['web/**']),
      component('scoped', ['packages/@acme/ui/**']),
    ])
    expect(folders(arch)).toEqual({ api: 'src/api', db: 'src/db', ui: 'web', scoped: 'packages/@acme/ui' })
  })

  it('reports a component it cannot place instead of guessing', () => {
    const arch = architecture([
      component('root', ['*.ts']),
      component('spread', ['api/**', 'web/**']),
      component('empty', []),
      component('graph', ['electron/contract/graph.ts']),
      component('app', ['electron/main.ts', 'electron/app/**']),
      component('outside', ['../evil/**']),
      component('climb', ['src/../lib/**']),
      component('built', ['dist/**']),
      component('hidden', ['.github/**']),
      component('one', ['shared/**']),
      component('two', ['shared/**']),
      component('typed', ['lib/**/*.ts']),
      component('carved', ['site/**', '!site/legacy/**']),
    ])
    expect(renderAgents(arch)).toEqual({
      placed: [],
      unplaced: [
        { component: 'root', reason: 'its globs share no folder below the project root' },
        { component: 'spread', reason: 'its globs share no folder below the project root' },
        { component: 'empty', reason: 'it owns nothing' },
        { component: 'graph', reason: 'it owns files in electron/contract but not the whole folder' },
        { component: 'app', reason: 'it owns files in electron but not the whole folder' },
        { component: 'outside', reason: 'its globs climb out with .., so its folder is not certain' },
        { component: 'climb', reason: 'its globs climb out with .., so its folder is not certain' },
        { component: 'built', reason: 'dist is a folder Architect does not scan' },
        { component: 'hidden', reason: '.github is a folder Architect does not scan' },
        { component: 'one', reason: 'it shares shared with two' },
        { component: 'two', reason: 'it shares shared with one' },
        { component: 'typed', reason: 'it owns files in lib but not the whole folder' },
        { component: 'carved', reason: 'it owns files in site but not the whole folder' },
      ],
    })
  })
})

describe('renderAgents content', () => {
  const arch = architecture([{ ...component('api', ['src/api/**'], 'Handles HTTP.'), covers: ['src/api/routes.ts#handle'] }, component('db', ['src/db/**']), component('ui', ['src/ui/**'])], {
    edges: [
      { from: 'api', to: 'db', label: 'reads orders' },
      { from: 'ui', to: 'api' },
    ],
    forbidden: [{ from: 'ui', to: 'db', reason: 'go through the api' }],
    rules: [
      { rule: 'lines', limit: 300, globs: [] },
      { rule: 'lines', limit: 900, globs: ['src/api/big.ts', 'src/ui/huge.ts'] },
      { rule: 'files', limit: 9, globs: ['src/db', '.'] },
    ],
  })
  const text = (id: string) => renderAgents(arch).placed.find((p) => p.component === id)?.text

  it('copies what the component owns, may call and must never call', () => {
    expect(text('api')).toBe(
      [
        MARKER,
        '# api',
        '',
        'Handles HTTP.',
        '',
        '## Owns',
        '',
        '- `src/api/**`',
        '- covers `src/api/routes.ts#handle`',
        '',
        '## May call',
        '',
        '- db: reads orders',
        '',
        '## Must never call',
        '',
        '- none',
        '',
        '## Rules',
        '',
        'A later line whose globs match a path overrides an earlier one.',
        '',
        '- files: 5',
        '- names: Manager, Helper, Service, Factory, Base',
        '- jobs: 1',
        '- split: 50 lines, 3 callers',
        '- skip: `**/*.test.*`, `**/*.spec.*`',
        '- lines: 300',
        '- lines: 900 `src/api/big.ts`',
        '',
      ].join('\n'),
    )
    expect(text('ui')).toContain('## May call\n\n- api\n')
    expect(text('ui')).toContain('## Must never call\n\n- db: go through the api\n')
    expect(text('db')).toContain('## May call\n\n- none\n')
  })

  it('keeps only rule lines and globs that reach the folder', () => {
    expect(text('db')).toContain('- files: 9 `src/db`')
    expect(text('db')).not.toContain('900')
    expect(text('ui')).toContain('- lines: 900 `src/ui/huge.ts`\n')
  })

  it('gives the same text for the same contract', () => {
    expect(renderAgents(arch)).toEqual(renderAgents(structuredClone(arch)))
  })
})
