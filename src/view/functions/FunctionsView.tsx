import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { DraftFailure, FunctionRow, FunctionsReport } from '../../../shared/types'
import { folderName } from '../../model/layout'
import { loadCodeMap, openFile, useProject } from '../../model/store'
import type { ViewProps } from '../../shell/views'
import { arrange, settled, type SortKey } from './order'
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

function failureText(failure: DraftFailure): string {
  if (failure.kind === 'not-installed') return 'Claude Code is not installed, so functions are not ranked'
  if (failure.kind === 'timed-out') return 'Claude took too long on some files'
  if (failure.kind === 'failed') return `Claude stopped with an error${failure.stderr ? `: ${failure.stderr}` : ''}`
  return 'Claude gave an answer that could not be read for some files'
}

function progressText(report: FunctionsReport): string {
  const head = plural(report.rows.length, 'function')
  if (report.failure?.kind === 'not-installed') return head
  if (report.done < report.total) return `${head} · ranking ${report.done}/${report.total} files`
  if (report.failed > 0) return `${head} · ${plural(report.failed, 'file')} not ranked`
  return `${head} · ${plural(report.total, 'file')} ranked`
}

function Mark({ importance }: { importance: number | null }) {
  return (
    <span
      className="fn-mark"
      role="img"
      aria-label={importance === null ? 'not ranked' : `importance ${importance} of 5`}
      title={importance === null ? 'Not ranked' : `Importance ${importance} of 5`}
    >
      {STEPS.map((step) => (
        <span key={step} className={importance !== null && step <= importance ? 'fn-step on' : 'fn-step'} />
      ))}
    </span>
  )
}

const Row = memo(function Row({
  row,
  pending,
  onOpen,
}: {
  row: FunctionRow
  pending: boolean
  onOpen: (row: FunctionRow) => void
}) {
  return (
    <li>
      <button className="fn-row" onClick={() => onOpen(row)} title={`${row.file}:${row.line}`}>
        <Mark importance={row.rank?.importance ?? null} />
        <span className="fn-main">
          <span className="fn-head">
            <span className="fn-name">{row.name}</span>
            <span className="fn-file">
              <bdi>{row.file}</bdi>
            </span>
          </span>
          {row.rank ? (
            <span className="fn-summary">{row.rank.summary}</span>
          ) : (
            <span className="fn-summary quiet">{pending ? 'ranking…' : 'not ranked'}</span>
          )}
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
  const { report, error } = useFunctions(currentRoot, codeMap)
  const [sort, setSort] = useState<SortKey>('importance')
  const [query, setQuery] = useState('')
  const needle = useDeferredValue(query)

  useEffect(() => {
    loadCodeMap()
  }, [currentRoot, codeMap])

  const final = report ? settled(report) : false
  const placed = useMemo(() => (report ? arrange(report.rows, sort, final, needle) : []), [report, sort, final, needle])
  const pending = report !== null && report.done < report.total && report.failure?.kind !== 'not-installed'

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
          {report ? progressText(report) : 'Reading functions…'}
          {report && sort === 'importance' && !final && report.rows.length > 0 && (
            <span className="fn-provisional"> · provisional order</span>
          )}
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

      {(error || report?.failure) && (
        <p className="fn-notice" role="status">
          {error ?? (report?.failure ? failureText(report.failure) : '')}
        </p>
      )}

      {report && report.rows.length === 0 ? (
        <p className="fn-empty">No functions found in this project.</p>
      ) : report && placed.length === 0 ? (
        <p className="fn-empty">No functions match “{needle}”.</p>
      ) : (
        <ul className="fn-list">
          {placed.map(({ row, key }) => (
            <Row key={key} row={row} pending={pending} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  )
}
