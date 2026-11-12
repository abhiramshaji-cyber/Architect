import { describe, expect, it } from 'vitest'
import type { Commit, HistoryEntry } from '../../../../shared/types'
import { stepsOf } from './steps'

const commit = (sha: string, at: number, files: string[]): Commit => ({
  sha,
  short: sha,
  at,
  subject: `s ${sha}`,
  files,
})

const entry = (id: string, at: number, source: 'code' | 'contract', changed: string[], session?: string): HistoryEntry => ({
  id,
  root: '/r',
  at,
  source,
  added: [],
  changed,
  removed: [],
  ...(session === undefined ? {} : { session }),
})

describe('replay timeline', () => {
  it('merges commits and history entries oldest first', () => {
    const steps = stepsOf(
      [commit('c2', 300, ['b.ts']), commit('c1', 100, ['a.ts'])],
      [entry('h2', 400, 'contract', ['ui->core']), entry('h1', 200, 'code', ['codefile:a.ts', 'folder:src'], 's1')],
      0,
    )
    expect(steps.map((step) => [step.key, step.files, step.components])).toEqual([
      ['c:c1', ['a.ts'], []],
      ['h:h1', ['a.ts'], []],
      ['c:c2', ['b.ts'], []],
      ['h:h2', [], ['ui', 'core']],
    ])
    expect(steps[1]?.session).toBe('s1')
    expect(steps[3]?.contract).toEqual(['ui -> core'])
  })

  it('keeps a commit before a history entry at the same moment', () => {
    const steps = stepsOf([commit('c', 100, ['a.ts'])], [entry('h', 100, 'code', ['codefile:a.ts'])], 0)
    expect(steps.map((step) => step.kind)).toEqual(['commit', 'code'])
  })

  it('drops steps before the window and steps with nothing to light', () => {
    const steps = stepsOf(
      [commit('old', 50, ['a.ts']), commit('merge', 150, [])],
      [entry('folders', 160, 'code', ['folder:src'])],
      100,
    )
    expect(steps).toEqual([])
  })
})
