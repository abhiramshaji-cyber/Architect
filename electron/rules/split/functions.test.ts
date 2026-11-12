import { describe, expect, it } from 'vitest'
import type { RuleEntry } from '../../../shared/types'
import { functionsIn } from '../../scan/scan'
import { effective } from '../audit'
import { factsOf, type SourceFacts } from '../facts'
import { functionSplits } from './functions'

const BODY = ['  if (n) {', '    return 1', '  }', ...Array.from({ length: 50 }, (_, i) => `  const v${i} = ${i}`), '  return 0'].join('\n')

const FILES: Record<string, string> = {
  'big.ts': `export function big(n: number) {\n${BODY}\n}\nexport function small() {\n  return 1\n}\n`,
  'a.ts': "import { big, small } from './big'\nexport function a() {\n  big(1)\n  big(2)\n  small()\n}\n",
  'b.ts': "import { big, small } from './big'\nexport function b() {\n  return big(3) + small()\n}\nexport function c() {\n  return big(4) + small()\n}\n",
  'self.ts': `export function self(n: number): number {\n${BODY}\n  return self(n - 1)\n}\n`,
}

function sources(): SourceFacts[] {
  const parsed = Object.entries(FILES).map(([file, text]) => ({ file, text, functions: functionsIn(text, file) }))
  const at = (file: string, name: string) => parsed.find((entry) => entry.file === file)?.functions.findIndex((fn) => fn.name === name) ?? -1
  for (const { file, functions } of parsed) {
    if (file === 'big.ts' || file === 'self.ts') continue
    for (const fn of functions) fn.calls = [{ file: 'big.ts', fn: at('big.ts', 'big') }, { file: 'big.ts', fn: at('big.ts', 'small') }]
  }
  const self = parsed.find((entry) => entry.file === 'self.ts')
  if (self?.functions[0]) self.functions[0].calls = [{ file: 'self.ts', fn: 0 }]
  return parsed.flatMap(({ file, text, functions }) => factsOf(file, () => text, () => functions) ?? [])
}

const read = (file: string) => FILES[file]

const run = (declared: RuleEntry[], given = sources()) => functionSplits(effective(declared), given, read)

describe('functionSplits', () => {
  it('flags a function over the line threshold with enough distinct callers, with its extraction points', () => {
    expect(run([])).toEqual([
      {
        kind: 'function',
        path: 'big.ts',
        name: 'big',
        line: 1,
        endLine: 56,
        lines: 56,
        callers: 3,
        threshold: { lines: 50, callers: 3 },
        points: [{ kind: 'if', label: 'if', line: 2, endLine: 4, lines: 3 }],
      },
    ])
  })

  it('reads both thresholds from the last matching split line, and off turns it off', () => {
    expect(run([{ rule: 'split', threshold: { lines: 50, callers: 4 }, globs: [] }])).toEqual([])
    expect(run([{ rule: 'split', threshold: { lines: 56, callers: 1 }, globs: [] }])).toEqual([])
    expect(run([{ rule: 'split', threshold: { lines: 55, callers: 3 }, globs: ['big.ts'] }]).map((split) => split.name)).toEqual(['big'])
    expect(run([{ rule: 'split', threshold: 'off', globs: ['big.ts'] }])).toEqual([])
  })

  it('never counts a function as its own caller', () => {
    expect(run([{ rule: 'split', threshold: { lines: 1, callers: 1 }, globs: ['self.ts'] }, { rule: 'split', threshold: 'off', globs: ['big.ts'] }])).toEqual([])
  })

  it('flags a function it cannot read without points, saying why', () => {
    const flagged = functionSplits(effective([]), sources(), () => undefined)
    expect(flagged[0]).toMatchObject({ name: 'big', points: [], blocked: 'no block body found in the parse' })
  })
})
