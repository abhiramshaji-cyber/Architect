import { useEffect, useRef, useState } from 'react'
import type { SearchResult } from '../../../shared/types'
import { openFile } from '../../model/store'

const DEBOUNCE_MS = 250

type Found = { query: string; result: SearchResult | null; error: string | null }

function statusOf(found: Found, query: string): string {
  if (query === '') return ''
  if (found.query !== query || (found.result === null && found.error === null)) return 'Searching…'
  if (found.error !== null) return found.error
  const count = found.result?.hits.length ?? 0
  if (count === 0) return 'No results'
  return found.result?.capped ? `First ${count} results` : `${count} ${count === 1 ? 'result' : 'results'}`
}

export default function SearchPanel({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Found>({ query: '', result: null, error: null })
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
  }, [])

  useEffect(() => {
    if (query === '') return
    let live = true
    const timer = setTimeout(() => {
      window.architect.search(query).then(
        (result) => live && setFound({ query, result, error: null }),
        (err: unknown) => live && setFound({ query, result: null, error: err instanceof Error ? err.message : String(err) })
      )
    }, DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query])

  const hits = found.query === query ? (found.result?.hits ?? []) : []

  return (
    <aside className="search" aria-label="Search in project">
      <input
        ref={input}
        className="search-input"
        placeholder="Search in project"
        aria-label="Search in project"
        value={query}
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return
          e.preventDefault()
          onClose()
        }}
      />
      <p className="search-status" role="status">
        {statusOf(found, query)}
      </p>
      <ul className="search-list">
        {hits.map((hit) => (
          <li key={`${hit.file}:${hit.line}`}>
            <button className="search-hit" onClick={() => openFile(hit.file, hit.line)} title={`${hit.file}:${hit.line}`}>
              <span className="search-where">
                {hit.file}:{hit.line}
              </span>
              <span className="search-text">{hit.text.trim() || ' '}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
