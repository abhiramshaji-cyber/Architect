import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { rank } from '../../model/picker'
import { step } from '../../shell/commands'

export type PickItem = { key: string; label: string; detail: string }

export default function QuickPick<T extends PickItem>({ placeholder, items, onPick, onClose }: {
  placeholder: string
  items: T[]
  onPick: (item: T) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const selectedRow = useRef<HTMLLIElement>(null)

  const matches = useMemo(() => rank(query, items, (item) => `${item.label} ${item.detail}`), [query, items])
  const selected = step(index, 0, matches.length)

  useEffect(() => {
    input.current?.focus()
  }, [])

  useEffect(() => {
    selectedRow.current?.scrollIntoView({ block: 'nearest' })
  }, [selected, query])

  const choose = (item: T | undefined) => {
    if (!item) return
    onClose()
    onPick(item)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex(step(selected, e.key === 'ArrowDown' ? 1 : -1, matches.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(matches[selected])
    }
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label={placeholder} onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <input
          ref={input}
          className="palette-input"
          placeholder={placeholder}
          aria-label={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
        />

        <p className="palette-count" role="status">
          {matches.length === 0 ? 'No matches' : `${matches.length} of ${items.length}`}
        </p>

        <ul className="palette-list" role="listbox" aria-label={placeholder}>
          {matches.map((item, at) => (
            <li
              key={item.key}
              ref={at === selected ? selectedRow : null}
              role="option"
              aria-selected={at === selected}
              className={`palette-item${at === selected ? ' selected' : ''}`}
              onMouseMove={() => setIndex(at)}
              onClick={() => choose(item)}
            >
              <span className="palette-label">{item.label}</span>
              <span className="quick-pick-detail">{item.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
