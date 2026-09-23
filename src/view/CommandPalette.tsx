import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { chordText, isEnabled, listCommands, matchCommands, step, type Command } from '../shell/commands'
import { getLeaderKey } from '../shell/leaderKey'

export default function CommandPalette({ scope, onClose }: { scope: string; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [commands] = useState<Command[]>(listCommands)
  const [leader] = useState(getLeaderKey)
  const input = useRef<HTMLInputElement>(null)
  const selectedRow = useRef<HTMLLIElement>(null)

  const matches = useMemo(() => matchCommands(query, commands, scope), [query, commands, scope])
  const selected = step(index, 0, matches.length)

  useEffect(() => {
    input.current?.focus()
  }, [])

  useEffect(() => {
    selectedRow.current?.scrollIntoView({ block: 'nearest' })
  }, [selected, query])

  const run = (command: Command) => {
    if (!isEnabled(command, scope)) return
    onClose()
    command.run()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex(step(selected, e.key === 'ArrowDown' ? 1 : -1, matches.length))
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      const command = matches[selected]
      if (command) run(command)
    }
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={input}
          className="palette-input"
          placeholder="Run a command"
          aria-label="Run a command"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
        />

        <p className="palette-count" role="status">
          {matches.length === 0 ? 'No command matches' : `${matches.length} of ${commands.length}`}
        </p>

        <ul className="palette-list" role="listbox" aria-label="Commands">
          {matches.map((command, at) => {
            const usable = isEnabled(command, scope)
            return (
              <li
                key={command.id}
                ref={at === selected ? selectedRow : null}
                role="option"
                aria-selected={at === selected}
                aria-disabled={!usable}
                className={`palette-item${at === selected ? ' selected' : ''}${usable ? '' : ' disabled'}`}
                onMouseMove={() => setIndex(at)}
                onClick={() => run(command)}
              >
                <span className="palette-label">{command.label}</span>
                {command.keys && <kbd className="palette-chord">{chordText(command.keys, leader)}</kbd>}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
