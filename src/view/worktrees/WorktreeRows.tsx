import { useState } from 'react'
import { worktreeText } from '../../model/picker'
import { worktreeLabel } from '../../model/removal'
import type { ClaudeWorktree } from '../../../shared/types'

type Props = {
  shown: ClaudeWorktree[]
  index: number
  checked: Set<string>
  now: number
  onPick: (event: React.MouseEvent, at: number) => void
  onToggle: (path: string) => void
  onOpen: (worktree: ClaudeWorktree) => void
}

export function useChecks(shown: ClaudeWorktree[]) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  const [anchor, setAnchor] = useState(0)

  function check(paths: string[], on: boolean): void {
    setChecked((current) => {
      const next = new Set(current)
      for (const path of paths) {
        if (on) next.add(path)
        else next.delete(path)
      }
      return next
    })
  }

  function toggle(path: string): void {
    check([path], !checked.has(path))
  }

  function mark(event: React.MouseEvent, at: number): void {
    const worktree = shown[at]
    if (!worktree) return

    if (event.shiftKey) check(shown.slice(Math.min(anchor, at), Math.max(anchor, at) + 1).map((row) => row.path), true)
    else setAnchor(at)
    if (event.metaKey || event.ctrlKey) toggle(worktree.path)
  }

  return { checked, check, toggle, mark, clear: () => setChecked(new Set()) }
}

export default function WorktreeRows({ shown, index, checked, now, onPick, onToggle, onOpen }: Props) {
  return (
    <>
      {shown.map((worktree, at) => (
        <li key={worktree.path} className="picker-check-row">
          <input type="checkbox" checked={checked.has(worktree.path)} onChange={() => onToggle(worktree.path)} aria-label={`Select ${worktreeLabel(worktree)}`} />
          <button
            className={at === index ? 'picker-row active' : 'picker-row'}
            onClick={(event) => onPick(event, at)}
            onDoubleClick={() => onOpen(worktree)}
          >
            <span className="picker-name">{worktreeLabel(worktree)}</span>
            <span className="picker-meta">{worktreeText(worktree, now)}</span>
          </button>
        </li>
      ))}
    </>
  )
}
