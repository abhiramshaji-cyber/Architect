import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { FileSplit, FunctionSplit } from '../../../../shared/types'
import Splits from './Splits'

const FILE: FileSplit = {
  kind: 'file',
  path: 'src/a.ts',
  lines: 260,
  over: { lines: { count: 260, limit: 200 }, jobs: { count: 2, limit: 1 } },
  folder: 'src/a',
  entry: 'src/a.ts',
  groups: [
    { name: 'go', file: 'src/a/go.ts', exported: ['go'], members: [{ name: 'go', line: 3, endLine: 9 }], lines: 7 },
    { unnamed: 'the leading words of the exported names tie: x x1, y x1', exported: ['xA', 'yB'], members: [{ name: 'xA', line: 11, endLine: 12 }], lines: 2 },
  ],
  stays: { lines: 251, functions: [] },
  files: { count: 1, limit: 5 },
}

const FN: FunctionSplit = {
  kind: 'function',
  path: 'src/b.ts',
  name: 'big',
  line: 4,
  endLine: 80,
  lines: 77,
  callers: 6,
  threshold: { lines: 50, callers: 3 },
  points: [{ kind: 'for of', label: 'for of', line: 10, endLine: 30, lines: 21 }],
}

const html = (splits: Parameters<typeof Splits>[0]['splits']) => renderToStaticMarkup(<Splits splits={splits} onGo={() => {}} />)

describe('Splits', () => {
  it('renders nothing without suggestions', () => {
    expect(html([])).toBe('')
  })

  it('lists file groups with their files, members and totals, and function extraction points', () => {
    const shown = html([FILE, FN])
    expect(shown).toContain('2 split suggestions')
    expect(shown).toContain('src/a.ts:1')
    expect(shown).toContain('260 lines, 2 job groups')
    expect(shown).toContain('src/a/go.ts')
    expect(shown).toContain('7 lines, go:3')
    expect(shown).toContain('Unnamed: the leading words of the exported names tie: x x1, y x1')
    expect(shown).toContain('1 of 5 code files in src/a/, 251 lines stay in the entry')
    expect(shown).toContain('big, 77 lines, 6 callers')
    expect(shown).toContain('Extract for of')
    expect(shown).toContain('10-30, 21 lines')
  })

  it('says why a file or function has no split', () => {
    const shown = html([{ ...FILE, files: { count: 1, limit: 'off' }, blocked: 'no exported function to group into a job' }, { ...FN, points: [], blocked: 'the body is one statement' }])
    expect(shown).toContain('No split: no exported function to group into a job')
    expect(shown).toContain('Flagged only: the body is one statement')
    expect(shown).not.toContain('Extract')
    expect(html([{ ...FILE, files: { count: 1, limit: 'off' } }])).toContain('1 code file in src/a/')
  })
})
