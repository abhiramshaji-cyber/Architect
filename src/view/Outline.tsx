import { useRef } from 'react'
import type { OutlineEntry } from '../model/outline'

type OutlineProps = {
  entries: OutlineEntry[]
  currentId: string | null
  onSelect: (id: string) => void
  returnFocus: () => void
}

export default function Outline({ entries, currentId, onSelect, returnFocus }: OutlineProps) {
  const list = useRef<HTMLDivElement | null>(null)

  const move = (from: HTMLElement, delta: number) => {
    const items = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('.outline-item') ?? [])
    const at = items.indexOf(from as HTMLButtonElement)
    const next = items[at + delta]
    next?.focus()
  }

  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(e.currentTarget, 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(e.currentTarget, -1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      returnFocus()
    }
  }

  return (
    <aside className="outline">
      <div className="outline-head">
        <h3>Outline</h3>
      </div>
      {entries.length === 0 ? (
        <p className="outline-empty">No symbols in this file</p>
      ) : (
        <div ref={list} className="outline-list" role="listbox" aria-label="Symbols in this file">
          {entries.map((entry) => (
            <button
              key={entry.id}
              className={entry.id === currentId ? 'outline-item current' : 'outline-item'}
              role="option"
              aria-selected={entry.id === currentId}
              onClick={() => onSelect(entry.id)}
              onKeyDown={onKey}
            >
              <span className="code-fn-name outline-item-name">{entry.name}</span>
              <span className="outline-item-line">{entry.line}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  )
}
