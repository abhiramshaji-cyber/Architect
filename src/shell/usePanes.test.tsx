import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { at } from './pane-tree'
import { usePanes } from './usePanes'

function Probe({ root }: { root: string | null }) {
  const panes = usePanes(root)
  const pane = at(panes.tree, panes.focus)
  return <span>{pane?.kind === 'leaf' ? pane.view : 'split'}</span>
}

describe('usePanes without a project', () => {
  it('a tab with no project lands on Repos, the front door', () => {
    expect(renderToStaticMarkup(<Probe root={null} />)).toContain('repos')
  })

  it('a tab with a project lands on the contract', () => {
    expect(renderToStaticMarkup(<Probe root="/a" />)).toContain('contract')
  })
})
