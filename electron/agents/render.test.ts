import { describe, expect, it } from 'vitest'
import type { Architecture, Component } from '../../shared/types'
import { MARKER, renderAgents } from './render'

const component = (id: string, owns: string[], purpose = `${id} things`): Component => ({ id, purpose, owns })

function architecture(components: Component[], extra: Partial<Architecture> = {}): Architecture {
  return { title: 'T', summary: 'S', components, edges: [], forbidden: [], packages: [], ...extra }
}

const folders = (arch: Architecture) => Object.fromEntries(renderAgents(arch).placed.map((p) => [p.component, p.folder]))

describe('renderAgents placement', () => {
  it('places each component at the folder its globs share', () => {
    const arch = architecture([
      component('api', ['src/api/**']),
      component('db', ['src/db/models/**', 'src/db/migrate/*.ts']),
      component('graph', ['electron/contract/graph.ts']),
      component('ui', ['web/**/*.tsx', '!web/legacy/**']),
    ])
    expect(folders(arch)).toEqual({ api: 'src/api', db: 'src/db', graph: 'electron/contract', ui: 'web' })
  })

  it('reports a component it cannot place instead of guessing', () => {
    const arch = architecture([
      component('root', ['*.ts']),
      component('spread', ['api/**', 'web/**']),
      component('empty', []),
      component('daemon', ['electron/daemon.ts']),
      component('app', ['electron/main.ts', 'electron/app/**']),
    ])
    expect(renderAgents(arch)).toEqual({
      placed: [],
      unplaced: [
        { component: 'root', reason: 'its globs share no folder below the project root' },
        { component: 'spread', reason: 'its globs share no folder below the project root' },
        { component: 'empty', reason: 'it owns nothing' },
        { component: 'daemon', reason: 'it shares electron with app' },
        { component: 'app', reason: 'it shares electron with daemon' },
      ],
    })
  })
})

describe('renderAgents content', () => {
  const arch = architecture([component('api', ['src/api/**'], 'Handles HTTP.'), component('db', ['src/db/**']), component('ui', ['src/ui/**'])], {
    edges: [
      { from: 'api', to: 'db', label: 'reads orders' },
      { from: 'ui', to: 'api' },
    ],
    forbidden: [{ from: 'ui', to: 'db', reason: 'go through the api' }],
    rules: [
      { rule: 'lines', limit: 300, globs: [] },
      { rule: 'lines', limit: 900, globs: ['src/api/big.ts', 'src/ui/huge.ts'] },
      { rule: 'files', limit: 9, globs: ['src/db'] },
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
        '- files: 5',
        '- names: Manager, Helper, Service, Factory, Base',
        '- jobs: 1',
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
