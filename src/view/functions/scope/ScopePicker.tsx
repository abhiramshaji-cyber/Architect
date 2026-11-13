import { useEffect, useMemo, useRef, useState } from 'react'
import type { ScopeFolder } from '../../../../shared/types'
import { crumbs } from '../../../model/codemap'
import { pickable } from './pick'

type PickerProps = {
  project: string
  scope: string
  folders: ScopeFolder[]
  onScope: (scope: string) => void
}

export default function ScopePicker({ project, scope, folders, onScope }: PickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const shown = useMemo(() => (open ? pickable(folders, scope, query) : []), [open, folders, scope, query])

  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const choose = (next: string) => {
    onScope(next)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="fn-scope" ref={box} onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}>
      <nav className="crumbs" aria-label="Folder">
        {crumbs(project, scope).map((crumb, at) => (
          <span key={crumb.path}>
            {at > 0 && <span className="crumb-sep">/</span>}
            <button
              className={crumb.path === scope ? 'crumb current' : 'crumb'}
              aria-current={crumb.path === scope ? 'location' : undefined}
              onClick={() => choose(crumb.path)}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </nav>
      <button
        className="cyber-btn cyber-btn--sm cyber-btn--ghost fn-scope-open"
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={folders.length === 0}
        title={folders.length === 0 ? 'No folders with functions inside' : 'Pick a folder inside this one'}
        onClick={() => setOpen((was) => !was)}
      >
        Folders ⌄
      </button>
      {open && (
        <div className="fn-scope-pop" role="dialog" aria-label="Pick a folder">
          <input
            className="cyber-input search-input"
            type="search"
            autoFocus
            placeholder="Find a folder"
            aria-label="Find a folder"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {shown.length === 0 ? (
            <p className="fn-scope-none">No folders match “{query.trim()}”.</p>
          ) : (
            <ul className="fn-scope-list">
              {shown.map((folder) => (
                <li key={folder.path}>
                  <button className="fn-scope-row" onClick={() => choose(folder.path)} title={folder.path}>
                    <span className="fn-scope-name">
                      <bdi>{folder.label}</bdi>
                    </span>
                    <span className="fn-scope-count">{folder.functions.toLocaleString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
