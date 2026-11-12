import { describe, expect, it } from 'vitest'
import type { CallSite, CodeMap, FileEntry, FileStart } from '../../shared/types'
import { parse } from '../contract/graph'
import { flowOf } from '.'
import { MOST_STEPS } from './walk'

type Fn = [name: string, line: number, sites?: CallSite[]]

function file(path: string, fns: Fn[], starts?: FileStart[]): FileEntry {
  const functions = fns.map(([name, line, sites]) => ({
    name,
    line,
    endLine: line + 1,
    description: '',
    calls: (sites ?? []).flatMap((site) => ('fn' in site ? [{ file: site.file, fn: site.fn }] : [])),
    ...(sites ? { sites } : {}),
  }))
  return { path, functions, ...(starts ? { starts } : {}) }
}

const map = (...files: FileEntry[]): CodeMap => ({ root: '/p', scannedAt: 0, folders: [{ path: '', folders: [], files }] })

const at = (file: string, fn: number, line: number): CallSite => ({ file, fn, line })

const tool = (file: string, fn: number): FileStart => ({ kind: 'mcpTool', calls: [{ file, fn }] })

const ask = (file: string, name: string, line: number, depth = 3, open: string[] = []) => ({ file, name, line, depth, open })

const summary = (steps: { callee: string; depth: number; times: number; mark?: string; more?: true }[]) =>
  steps.map(
    (s) =>
      `${'.'.repeat(s.depth)}${s.callee}${s.times > 1 ? `x${s.times}` : ''}${s.mark ? ` ${s.mark}` : ''}${s.more ? ' +' : ''}`,
  )

describe('flowOf', () => {
  const chain = map(
    file(
      'a/main.ts',
      [
        ['start', 1, [at('a/main.ts', 1, 3), at('b/lib.ts', 0, 4), at('a/main.ts', 1, 5)]],
        ['helper', 10, [at('b/lib.ts', 0, 11)]],
      ],
      [tool('a/main.ts', 0)],
    ),
    file('b/lib.ts', [
      ['leaf', 1, [at('b/lib.ts', 1, 2)]],
      ['deep', 5, [at('b/lib.ts', 2, 6)]],
      ['deeper', 9, [at('b/lib.ts', 1, 10)]],
    ]),
  )

  it('draws calls in source order, groups repeated sites and marks what is drawn above', () => {
    const flow = flowOf(chain, new Map(), null, ask('a/main.ts', 'start', 1))
    expect(summary(flow.steps)).toEqual(['helperx2', '.leaf', '..deep +', 'leaf repeat'])
    expect(flow.lanes).toEqual(['a', 'b'])
    expect(flow.steps[0]).toMatchObject({ from: 'a', to: 'a', file: 'a/main.ts', line: 3, target: 'a/main.ts', targetLine: 10 })
    expect(flow.entry).toEqual({ reason: 'mcpTool', file: 'a/main.ts' })
  })

  it('caps the depth, marks the cut call and opens it one more level on request', () => {
    const flow = flowOf(chain, new Map(), null, ask('a/main.ts', 'start', 1))
    expect(flow.steps.find((s) => s.callee === 'deep')?.more).toBe(true)
    const opened = flowOf(chain, new Map(), null, ask('a/main.ts', 'start', 1, 3, ['b/lib.ts#1']))
    expect(summary(opened.steps)).toEqual(['helperx2', '.leaf', '..deep', '...deeper +', 'leaf repeat'])
    const both = flowOf(chain, new Map(), null, ask('a/main.ts', 'start', 1, 3, ['b/lib.ts#1', 'b/lib.ts#2']))
    expect(summary(both.steps)).toEqual(['helperx2', '.leaf', '..deep', '...deeper', '....deep cycle', 'leaf repeat'])
  })

  it('marks recursion once and never loops', () => {
    const self = map(file('x.ts', [['go', 1, [at('x.ts', 0, 2), at('x.ts', 0, 3)]]], [tool('x.ts', 0)]))
    expect(summary(flowOf(self, new Map(), null, ask('x.ts', 'go', 1, 64)).steps)).toEqual(['gox2 cycle'])
  })

  it('refuses a function that is not a starting point and a malformed ask', () => {
    expect(() => flowOf(chain, new Map(), null, ask('a/main.ts', 'helper', 10))).toThrow('not a starting point')
    expect(() => flowOf(chain, new Map(), null, ask('a/main.ts', 'gone', 1))).toThrow('not in the scan')
    expect(() => flowOf(chain, new Map(), null, { ...ask('a/main.ts', 'start', 1), depth: 0 })).toThrow('not a flow request')
    expect(() => flowOf(chain, new Map(), null, null)).toThrow('not a flow request')
  })

  it('uses architect.md components as lifelines and carries the reason of a forbidden call', () => {
    const contract = parse(
      [
        '# Architecture',
        '## Components',
        '### app',
        'owns: `a/**`',
        '### lib',
        'owns: `b/lib.ts`',
        '## Forbidden',
        '- app -> lib : app reaches lib through the bridge',
      ].join('\n'),
    )
    const flow = flowOf(chain, new Map(), contract, ask('a/main.ts', 'start', 1))
    expect(flow.contract).toBe(true)
    expect(flow.lanes).toEqual(['app', 'lib'])
    expect(flow.steps.find((s) => s.callee === 'leaf')?.forbidden).toBe('app → lib: app reaches lib through the bridge')
    expect(flow.steps.find((s) => s.callee === 'deep')?.forbidden).toBeUndefined()
  })

  it('joins a renderer bridge call to the ipcMain handler on the channel the member sends on', () => {
    const ipc = map(
      file(
        'main/ipc.ts',
        [],
        [
          {
            kind: 'ipcHandler',
            calls: [{ file: 'main/work.ts', fn: 0 }],
            channel: 'api:read',
            line: 7,
            sites: [at('main/work.ts', 0, 7)],
          },
        ],
      ),
      file('main/work.ts', [['read', 3]]),
      file(
        'preload/index.ts',
        [['api.read', 2]],
        [{ kind: 'bridge', calls: [{ file: 'preload/index.ts', fn: 0 }], member: 'api.read', channel: 'api:read', line: 2 }],
      ),
      file(
        'ui/view.ts',
        [
          [
            'load',
            1,
            [
              { bridge: 'api.read', line: 2 },
              { bridge: 'api.gone', line: 3 },
            ],
          ],
        ],
        [{ kind: 'mcpTool', calls: [{ file: 'ui/view.ts', fn: 0 }] }],
      ),
    )
    const flow = flowOf(ipc, new Map(), null, ask('ui/view.ts', 'load', 1))
    expect(
      flow.steps.map(({ callee, ipc: channel, from, to, line, depth }) => ({ callee, channel, from, to, line, depth })),
    ).toEqual([
      { callee: 'api:read', channel: 'api:read', from: 'ui', to: 'main', line: 2, depth: 0 },
      { callee: 'read', channel: undefined, from: 'main', to: 'main', line: 7, depth: 1 },
    ])
  })

  it('stops at the step limit and says so', () => {
    const wide = Array.from({ length: MOST_STEPS + 5 }, (_, i) => at('w.ts', i + 1, i + 2))
    const fns: Fn[] = [['root', 1, wide], ...Array.from({ length: MOST_STEPS + 5 }, (_, i): Fn => [`f${i}`, i + 10])]
    const flow = flowOf(map(file('w.ts', fns, [tool('w.ts', 0)])), new Map(), null, ask('w.ts', 'root', 1))
    expect(flow.steps).toHaveLength(MOST_STEPS)
    expect(flow.cut).toBe(true)
  })
})
