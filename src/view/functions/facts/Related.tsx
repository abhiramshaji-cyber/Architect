import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FunctionList, FunctionRow } from '../../../../shared/types'
import { plural } from '../Mark'
import { callersOf, type Asked, type Way } from './calls'

type RelatedProps = {
  list: FunctionList
  asked: Asked
  onOpen: (row: FunctionRow) => void
  onClose: () => void
}

export function useRelated(list: FunctionList | null) {
  const [asked, setAsked] = useState<Asked | null>(null)
  const ask = useCallback((at: number, way: Way) => setAsked({ at, way }), [])
  const close = useCallback(() => setAsked(null), [])

  useEffect(() => {
    setAsked(null)
  }, [list])

  return { asked, ask, close }
}

export default function Related({ list, asked, onOpen, onClose }: RelatedProps) {
  const callers = useMemo(() => callersOf(list.calls), [list.calls])

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  const row = list.rows[asked.at]
  if (!row) return null
  const ats = (asked.way === 'callers' ? callers : list.calls)[asked.at] ?? []
  const outside = asked.way === 'callers' ? (row.outside ?? 0) : 0

  return (
    <div className="fn-related-dock">
      <aside className="fn-related" aria-label={`${asked.way} of ${row.name}`}>
        <header className="fn-related-head">
          <span className="fn-related-title">
            {asked.way === 'callers' ? 'Called by' : 'Calls'} <code>{row.name}</code>
          </span>
          <button className="fn-related-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <ul className="fn-related-list">
          {ats.flatMap((at) => {
            const other = list.rows[at]
            if (!other) return []
            return [
              <li key={at}>
                <button className="fn-related-item" onClick={() => onOpen(other)} title={`${other.file}:${other.line}`}>
                  <span className="fn-related-name">{other.name}</span>
                  <span className="fn-related-file">
                    <bdi>
                      {other.file}:{other.line}
                    </bdi>
                  </span>
                </button>
              </li>,
            ]
          })}
        </ul>
        {outside > 0 && <p className="fn-related-note">{plural(outside, 'caller')} outside this folder</p>}
      </aside>
    </div>
  )
}
