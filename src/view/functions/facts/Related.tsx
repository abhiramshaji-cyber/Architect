import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import type { FunctionList, FunctionRow } from '../../../../shared/types'
import { plural } from '../Mark'
import { callersOf, shownOf, type Asked, type Way } from './calls'

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
  const shown = shownOf(list, callers, asked)
  if (!shown) return null

  const close = (event: KeyboardEvent) => {
    if (event.key === 'Escape') onClose()
  }

  return (
    <div className="fn-related-dock">
      <aside key={`${asked.at}:${asked.way}`} className="fn-related" aria-label={`${asked.way} of ${shown.row.name}`} onKeyDown={close}>
        <header className="fn-related-head">
          <span className="fn-related-title">
            {asked.way === 'callers' ? 'Called by' : 'Calls'} <code>{shown.row.name}</code>
          </span>
          <button className="fn-related-close" aria-label="Close" autoFocus onClick={onClose}>
            ×
          </button>
        </header>
        <ul className="fn-related-list">
          {shown.related.map(({ at, row }) => (
            <li key={at}>
              <button className="fn-related-item" onClick={() => onOpen(row)} title={`${row.file}:${row.line}`}>
                <span className="fn-related-name">{row.name}</span>
                <span className="fn-related-file">
                  <bdi>
                    {row.file}:{row.line}
                  </bdi>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {shown.outside > 0 && (
          <p className="fn-related-note">
            {plural(shown.outside, asked.way === 'callers' ? 'caller' : 'callee')} outside this folder
          </p>
        )}
      </aside>
    </div>
  )
}
