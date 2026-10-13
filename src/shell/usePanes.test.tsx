import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { at } from './pane-tree'
import { usePanes } from './usePanes'
import { shownView } from './views'

function Probe({ root }: { root: string | null }) {
  const panes = usePanes(root)
  const pane = at(panes.tree, panes.focus)
  return <span>{pane?.kind === 'leaf' ? shownView(pane.view, root !== null) : 'split'}</span>
}

describe('usePanes without a project', () => {
  it('a tab with no project lands on Repos, the front door', () => {
    expect(renderToStaticMarkup(<Probe root={null} />)).toContain('repos')
  })

  it('a tab with a project lands on the contract', () => {
    expect(renderToStaticMarkup(<Probe root="/a" />)).toContain('contract')
  })
})

describe('shownView', () => {
  it('shows Repos on every pane of a tab with no project', () => {
    expect(shownView('diff', false)).toBe('repos')
    expect(shownView('repos', false)).toBe('repos')
  })

  it('never shows Repos once a project is bound', () => {
    expect(shownView('repos', true)).toBe('contract')
    expect(shownView('terminal', true)).toBe('terminal')
  })
})
