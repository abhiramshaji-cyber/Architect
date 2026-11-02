import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { FunctionRow } from '../../../shared/types'
import { folderName } from '../../model/layout'
import { loadCodeMap, openFile, useProject } from '../../model/store'
import type { ViewProps } from '../../shell/views'
import Mark, { plural } from './Mark'
import { arrange, type SortKey } from './order'
import FunctionTree from './tree/FunctionTree'
import { useFunctions } from './useFunctions'

type Mode = 'list' | 'tree'

const MODES: { key: Mode; label: string }[] = [
  { key: 'list', label: 'List' },
  { key: 'tree', label: 'Tree' },
]

const MODE_KEY = 'architect.functions.mode:'

function storedMode(root: string | null): Mode {
  try {
    return root && localStorage.getItem(MODE_KEY + root) === 'tree' ? 'tree' : 'list'
  } catch {
    return 'list'
  }
}

function storeMode(root: string | null, mode: Mode) {
  try {
    if (root) localStorage.setItem(MODE_KEY + root, mode)
  } catch {}
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'importance', label: 'Importance' },
  { key: 'lines', label: 'Lines' },
  { key: 'name', label: 'Name' },
]

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
  const { list, error } = useFunctions(currentRoot, codeMap)
  const rows = list?.rows ?? null
  const [mode, setMode] = useState<Mode>(() => storedMode(currentRoot))
  const [sort, setSort] = useState<SortKey>('importance')
  const [query, setQuery] = useState('')
  const needle = useDeferredValue(query)

  useEffect(() => {
    loadCodeMap()
  }, [currentRoot, codeMap])

  useEffect(() => {
    setMode(storedMode(currentRoot))
  }, [currentRoot])

  const pickMode = (next: Mode) => {
    setMode(next)
    storeMode(currentRoot, next)
  }

  const placed = useMemo(
    () => (rows && mode === 'list' ? arrange(rows, sort, needle) : []),
    [rows, mode, sort, needle],
  )

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
        <div className="fn-sort" role="group" aria-label="View">
          {MODES.map(({ key, label }) => (
            <button
              key={key}
              className={key === mode ? 'mode active' : 'mode'}
              aria-pressed={key === mode}
              onClick={() => pickMode(key)}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === 'list' && (
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
        )}
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
      ) : list && mode === 'tree' ? (
        <FunctionTree list={list} query={needle} project={folderName(currentRoot)} onOpen={onOpen} />
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
