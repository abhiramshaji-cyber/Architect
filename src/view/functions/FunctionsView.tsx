import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { FunctionRow } from '../../../shared/types'
import { folderName } from '../../model/layout'
import { loadCodeMap, openFile, useProject } from '../../model/store'
import type { ViewProps } from '../../shell/views'
import { arrange, type SortKey } from './order'
import { useFunctions } from './useFunctions'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'importance', label: 'Importance' },
  { key: 'lines', label: 'Lines' },
  { key: 'name', label: 'Name' },
]

const STEPS = [1, 2, 3, 4, 5]

function plural(count: number, word: string): string {
  return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`
}

function Mark({ importance }: { importance: number }) {
  return (
    <span className="fn-mark" role="img" aria-label={`importance ${importance} of 5`} title={`Importance ${importance} of 5`}>
      {STEPS.map((step) => (
        <span key={step} className={step <= importance ? 'fn-step on' : 'fn-step'} />
      ))}
    </span>
  )
}

const Row = memo(function Row({ row, onOpen }: { row: FunctionRow; onOpen: (row: FunctionRow) => void }) {
  return (
    <li>
      <button className="fn-row" onClick={() => onOpen(row)} title={`${row.file}:${row.line}`}>
        <Mark importance={row.importance} />
        <span className="fn-main">
          <span className="fn-head">
            <span className="fn-name">{row.name}</span>
            <span className="fn-file">
              <bdi>{row.file}</bdi>
            </span>
          </span>
          <span className="fn-summary">{row.summary}</span>
        </span>
        <span className="fn-lines" aria-label={plural(row.lines, 'line')}>
          {row.lines.toLocaleString()}
        </span>
      </button>
    </li>
  )
})

export default function FunctionsView({ show }: ViewProps) {
  const { currentRoot, codeMap } = useProject()
  const { rows, error } = useFunctions(currentRoot, codeMap)
  const [sort, setSort] = useState<SortKey>('importance')
  const [query, setQuery] = useState('')
  const needle = useDeferredValue(query)

  useEffect(() => {
    loadCodeMap()
  }, [currentRoot, codeMap])

  const placed = useMemo(() => (rows ? arrange(rows, sort, needle) : []), [rows, sort, needle])

  const showLatest = useRef(show)
  showLatest.current = show
  const onOpen = useCallback((row: FunctionRow) => {
    openFile(row.file, row.line)
    showLatest.current('files')
  }, [])

  if (!currentRoot) return null

  return (
    <section className="functions">
      <header className="canvas-header">
        <h2>Functions</h2>
        <p className="canvas-path">{folderName(currentRoot)}</p>
      </header>

      <div className="fn-bar">
        <p className="fn-count" aria-live="polite">
          {rows ? plural(rows.length, 'function') : 'Reading functions…'}
        </p>
        <div className="fn-sort" role="group" aria-label="Sort by">
          {SORTS.map(({ key, label }) => (
            <button
              key={key}
              className={key === sort ? 'mode active' : 'mode'}
              aria-pressed={key === sort}
              onClick={() => setSort(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className="search-input fn-search"
          type="search"
          placeholder="Filter by name, file or summary"
          aria-label="Filter functions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && (
        <p className="fn-notice" role="status">
          {error}
        </p>
      )}

      {rows && rows.length === 0 ? (
        <p className="fn-empty">No functions found in this project.</p>
      ) : rows && placed.length === 0 ? (
        <p className="fn-empty">No functions match “{needle}”.</p>
      ) : (
        <ul className="fn-list">
          {placed.map(({ row, key }) => (
            <Row key={key} row={row} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  )
}
