import { describe, expect, it } from 'vitest'
import type { Kind, MapNode } from '../../map/layout/nest'
import { light } from './light'
import type { Step } from './steps'

const node = (id: string, kind: Kind, path: string, children: MapNode[] = []): MapNode => ({
  id,
  label: id,
  kind,
  path,
  weight: 1,
  children,
})

const tree = node('root', 'root', '', [
  node('ui', 'component', 'ui', [
    node('a', 'file', 'src/a.ts', [node('a1', 'function', 'src/a.ts'), node('ar', 'rest', 'src/a.ts')]),
    node('b', 'file', 'src/b.ts', [node('b1', 'function', 'src/b.ts')]),
  ]),
  node('core', 'component', 'core', [node('c', 'file', 'lib/c.ts', [node('c1', 'function', 'lib/c.ts')])]),
])

const step = (files: string[], components: string[] = []): Step => ({
  key: files.join() + components.join(),
  at: 0,
  kind: components.length > 0 ? 'contract' : 'commit',
  files,
  components,
  title: '',
})

describe('replay light', () => {
  it('lights the files of the step, dims files changed before and leaves the rest unlit', () => {
    const { values, found } = light(tree, [step(['lib/c.ts']), step(['src/a.ts', 'gone.ts'])], 1)
    expect(['a1', 'ar', 'a', 'b1', 'b', 'c1', 'c', 'ui', 'core', 'root'].map((id) => values.get(id))).toEqual([
      1,
      1,
      1,
      null,
      null,
      0,
      0,
      1,
      0,
      1,
    ])
    expect(found).toBe(1)
  })

  it('lights every tile of a component a contract step changed', () => {
    const { values, found } = light(tree, [step([], ['core'])], 0)
    expect([values.get('c1'), values.get('core'), values.get('a1'), values.get('ui')]).toEqual([1, 1, null, null])
    expect(found).toBe(0)
  })

  it('lights nothing past the last step', () => {
    const { values } = light(tree, [step(['src/a.ts'])], 5)
    expect(values.get('a1')).toBe(0)
  })
})
