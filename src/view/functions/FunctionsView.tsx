import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { FunctionRow } from '../../../shared/types'
import { baseName } from '../../model/codemap'
import { folderName } from '../../model/layout'
import { ranker } from '../../model/recency'
import { loadCodeMap, openFile, useProject } from '../../model/store'
import Legend from '../recency/Legend'
import { useRecency } from '../recency/useRecency'
import type { ViewProps } from '../../shell/views'
import { plural } from './Mark'
import Row from './Row'
import { arrange, changeOf, type SortKey } from './order'
import ScopePicker from './scope/ScopePicker'
import { storeScope, storedScope } from './scope/pick'
import FunctionTree from './tree/FunctionTree'
import { useFunctions } from './useFunctions'
import Related, { useRelated } from './facts/Related'

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
  { key: 'recent', label: 'Recent' },
]

export default function FunctionsView({ show }: ViewProps) {
  const { currentRoot, codeMap } = useProject()
  const [scope, setScope] = useState(() => storedScope(currentRoot))
  const { list, error, asked } = useFunctions(currentRoot, codeMap, scope)
  const rows = list?.rows ?? null
  const shownScope = list?.scope ?? scope
  const [mode, setMode] = useState<Mode>(() => storedMode(currentRoot))
  const [sort, setSort] = useState<SortKey>('importance')
  const [query, setQuery] = useState('')
  const needle = useDeferredValue(query)
  const changes = useRecency(currentRoot, codeMap)?.functions
  const stepOf = useMemo(() => ranker(Object.values(changes ?? {})), [changes])
  const related = useRelated(list)

  useEffect(() => {
    loadCodeMap()
  }, [currentRoot, codeMap])

  useEffect(() => {
    setMode(storedMode(currentRoot))
    setScope(storedScope(currentRoot))
  }, [currentRoot])

  const pickScope = useCallback(
    (next: string) => {
      setScope(next)
      storeScope(currentRoot, next)
    },
    [currentRoot],
  )

  useEffect(() => {
    if (list && asked?.root === currentRoot && asked.scope === scope && list.scope !== scope) pickScope(list.scope)
  }, [list, asked, currentRoot, scope, pickScope])

  const pickMode = (next: Mode) => {
    setMode(next)
    storeMode(currentRoot, next)
  }

  const placed = useMemo(
    () => (rows && mode === 'list' ? arrange(rows, sort, needle, changes) : []),
    [rows, mode, sort, needle, changes],
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
          {!rows
            ? 'Reading functions…'
            : shownScope === ''
              ? plural(rows.length, 'function')
              : `${plural(rows.length, 'function')} in ${shownScope}`}
        </p>
        <ScopePicker
          project={folderName(currentRoot)}
          scope={shownScope}
          folders={list?.folders ?? []}
          onScope={pickScope}
        />
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
        {mode === 'list' && changes && Object.keys(changes).length > 0 && <Legend />}
        <input
          className="search-input fn-search"
          type="search"
          placeholder="Filter by name, file or doc"
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
        <p className="fn-empty">
          {shownScope === '' ? 'No functions found in this project.' : `No functions found in ${shownScope}.`}
        </p>
      ) : list && mode === 'tree' ? (
        <FunctionTree
          key={shownScope}
          list={list}
          query={needle}
          project={shownScope === '' ? folderName(currentRoot) : baseName(shownScope)}
          onOpen={onOpen}
          onRelated={related.ask}
        />
      ) : rows && placed.length === 0 ? (
        <p className="fn-empty">No functions match “{needle}”.</p>
      ) : (
        <ul className="fn-list">
          {placed.map(({ row, at, key }) => {
            const change = changes && changeOf(row, changes)
            const step = stepOf(change)
            return <Row key={key} {...{ row, at, change, step, onOpen }} onScope={pickScope} onRelated={related.ask} />
          })}
        </ul>
      )}
      {list && related.asked && <Related list={list} asked={related.asked} onOpen={onOpen} onClose={related.close} />}
    </section>
  )
}
