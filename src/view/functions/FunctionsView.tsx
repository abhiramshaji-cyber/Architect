import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { FunctionRow } from '../../../shared/types'
import { baseName } from '../../model/codemap'
import { folderName } from '../../model/layout'
import { ranker } from '../../model/recency'
import { loadCodeMap, openFile, useProject } from '../../model/store'
import FocusView from '../focus/FocusView'
import { keyOf, walk, type Trail } from '../focus/history'
import { useRecency } from '../recency/useRecency'
import type { ViewProps } from '../../shell/views'
import Bar from './bar/Bar'
import { storeMode, storedMode, type Mode } from './bar/mode'
import Row from './Row'
import { arrange, changeOf, type SortKey } from './order'
import { storeScope, storedScope } from './scope/pick'
import FunctionTree from './tree/FunctionTree'
import { useFunctions } from './useFunctions'
import Related, { useRelated } from './facts/Related'
import Splits from './splits/Splits'

export default function FunctionsView({ show }: ViewProps) {
  const { currentRoot, codeMap } = useProject()
  const [scope, setScope] = useState(() => storedScope(currentRoot))
  const { list, error, asked } = useFunctions(currentRoot, codeMap, scope)
  const rows = list?.rows ?? null
  const shownScope = list?.scope ?? scope
  const [mode, setMode] = useState<Mode>(() => storedMode(currentRoot))
  const [trail, setTrail] = useState<Trail | null>(null)
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
    setTrail(null)
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

  const pickMode = useCallback(
    (next: Mode) => {
      setMode(next)
      storeMode(currentRoot, next)
    },
    [currentRoot],
  )

  const onTrail = useCallback(
    (next: Trail) => {
      setTrail(next)
      related.close()
    },
    [related.close],
  )

  const onFocus = useCallback(
    (at: number) => {
      const row = rows?.[at]
      if (!row) return
      setTrail((prev) => walk(prev, { to: keyOf(row) }))
      related.close()
      pickMode('focus')
    },
    [rows, related.close, pickMode],
  )

  const placed = useMemo(
    () => (rows && mode === 'list' ? arrange(rows, sort, needle, changes) : []),
    [rows, mode, sort, needle, changes],
  )

  const showLatest = useRef(show)
  showLatest.current = show
  const onGo = useCallback((file: string, line: number) => {
    openFile(file, line)
    showLatest.current('files')
  }, [])
  const onOpen = useCallback((row: FunctionRow) => onGo(row.file, row.line), [onGo])

  if (!currentRoot) return null

  return (
    <section className="functions">
      <header className="canvas-header">
        <h2>Functions</h2>
        <p className="canvas-path">{folderName(currentRoot)}</p>
      </header>

      <Bar
        count={rows?.length ?? null}
        project={folderName(currentRoot)}
        scope={shownScope}
        folders={list?.folders ?? []}
        mode={mode}
        sort={sort}
        legend={changes !== undefined && Object.keys(changes).length > 0}
        query={query}
        onScope={pickScope}
        onMode={pickMode}
        onSort={setSort}
        onQuery={setQuery}
      />

      {list?.splits && mode === 'list' && <Splits splits={list.splits} onGo={onGo} />}

      {error && (
        <p className="fn-notice" role="status">
          {error}
        </p>
      )}

      {rows && rows.length === 0 ? (
        <p className="fn-empty">
          {shownScope === '' ? 'No functions found in this project.' : `No functions found in ${shownScope}.`}
        </p>
      ) : list && mode === 'focus' ? (
        <FocusView list={list} trail={trail} onTrail={onTrail} onOpen={onOpen} onRelated={related.ask} onScope={pickScope} />
      ) : list && mode === 'tree' ? (
        <FunctionTree
          key={shownScope}
          list={list}
          query={needle}
          project={shownScope === '' ? folderName(currentRoot) : baseName(shownScope)}
          onOpen={onOpen}
          onRelated={related.ask}
          onFocus={onFocus}
        />
      ) : rows && placed.length === 0 ? (
        <p className="fn-empty">No functions match “{needle}”.</p>
      ) : (
        <ul className="fn-list">
          {placed.map(({ row, at, key }) => {
            const change = changes && changeOf(row, changes)
            const step = stepOf(change)
            return <Row key={key} {...{ row, at, change, step, onOpen, onFocus }} onScope={pickScope} onRelated={related.ask} />
          })}
        </ul>
      )}
      {list && related.asked && <Related list={list} asked={related.asked} onOpen={onOpen} onClose={related.close} />}
    </section>
  )
}
