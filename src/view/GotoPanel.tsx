import { useEffect, useState } from 'react'
import type { SourceWindow } from '../../shared/types'
import type { GotoResult, Located } from '../model/goto'

const SNIPPET_LINES = 6
const REFS_SHOWN = 30

type GotoPanelProps = {
  root: string
  result: GotoResult
  onClose: () => void
  onJump: (item: Located) => void
}

function Snippet({ root, at }: { root: string; at: Located }) {
  const [source, setSource] = useState<SourceWindow | null>(null)

  useEffect(() => {
    setSource(null)
    let live = true
    window.architect
      .readSource(root, at.file, at.line, Math.min(SNIPPET_LINES, at.endLine - at.line + 1))
      .then((window) => {
        if (live) setSource(window)
      })
      .catch(() => {
        if (live) setSource({ from: at.line, lines: [], total: 0, error: 'unreadable' })
      })
    return () => {
      live = false
    }
  }, [root, at.file, at.line, at.endLine])

  if (!source) return <p className="goto-hint">Loading…</p>
  if (source.error || source.lines.length === 0) return <p className="goto-hint">No preview available</p>

  return (
    <pre className="goto-snippet">
      {source.lines.map((line, i) => (
        <div key={i} className="goto-snippet-line">
          <span className="goto-snippet-no">{source.from + i}</span>
          <span>{line}</span>
        </div>
      ))}
    </pre>
  )
}

function Row({ item, onFocus, onJump }: { item: Located; onFocus: () => void; onJump: () => void }) {
  return (
    <li className="goto-item">
      <button className="goto-item-main" onClick={onFocus}>
        <span className="code-fn-name">{item.name}</span>
        <span className="goto-item-loc">
          {item.file}:{item.line}
        </span>
      </button>
      <button className="goto-go" onClick={onJump} aria-label={`Go to ${item.name}`}>
        →
      </button>
    </li>
  )
}

function List({ title, items, onFocus, onJump }: {
  title: string
  items: Located[]
  onFocus: (item: Located) => void
  onJump: (item: Located) => void
}) {
  const shown = items.slice(0, REFS_SHOWN)
  const hidden = items.length - shown.length

  return (
    <section className="goto-section">
      <h4>
        {title} ({items.length})
      </h4>
      {items.length === 0 ? (
        <p className="goto-hint">None</p>
      ) : (
        <ul className="goto-list">
          {shown.map((item) => (
            <Row key={`${item.file}#${item.index}`} item={item} onFocus={() => onFocus(item)} onJump={() => onJump(item)} />
          ))}
        </ul>
      )}
      {hidden > 0 && <p className="goto-hint">+{hidden} more, not shown</p>}
    </section>
  )
}

export default function GotoPanel({ root, result, onClose, onJump }: GotoPanelProps) {
  const found = result.status === 'found'
  const defKey = found ? `${result.def.file}#${result.def.index}` : ''
  const [focus, setFocus] = useState<Located | null>(found ? result.def : null)

  useEffect(() => {
    setFocus(found ? result.def : null)
  }, [defKey])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="goto-panel" role="dialog" aria-label="Definition and references">
      <div className="goto-head">
        <span className="goto-title">
          {found ? result.def.name : 'Go to definition'}
        </span>
        <button className="inspector-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      {result.status === 'no-map' && <p className="goto-hint">The code map has not loaded yet.</p>}
      {result.status === 'unresolved' && (
        <p className="goto-hint">No definition found. This symbol may be stale — try rescanning.</p>
      )}

      {found && (
        <>
          <section className="goto-section">
            <h4>Definition</h4>
            <p className="goto-item-loc">
              {result.def.file}:{result.def.line}
            </p>
          </section>

          {focus && <Snippet root={root} at={focus} />}

          <List title="Called by" items={result.callers} onFocus={setFocus} onJump={onJump} />
          <List title="Calls" items={result.callees} onFocus={setFocus} onJump={onJump} />
        </>
      )}
    </div>
  )
}
