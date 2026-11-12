import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { folderName } from '../../model/layout'
import { loadCodeMap, openFile, rescan, useProject } from '../../model/store'
import type { ViewProps } from '../../shell/views'
import { keyOf } from '../focus/history'
import { Choice } from '../functions/bar/Bar'
import { storeFocus, storeMode } from '../functions/bar/mode'
import { plural } from '../functions/Mark'
import { storeScope, storedScope } from '../functions/scope/pick'
import { rank, type Hotspot, type Level } from './rank'
import Scatter from './Scatter'
import { useChurn } from './useChurn'

type Days = '30' | '90' | '365'

const LEVELS: { key: Level; label: string }[] = [
  { key: 'files', label: 'Files' },
  { key: 'functions', label: 'Functions' },
]

const WINDOWS: { key: Days; label: string }[] = [
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: '365', label: '365 days' },
]

const TOP = 20

function numbers(item: Hotspot): string {
  const changed = item.added === undefined ? '' : `, +${item.added} −${item.removed ?? 0} lines`
  return `${plural(item.lines, 'line')}, ${plural(item.commits, 'commit')}${changed}, score ${item.score.toFixed(3)}`
}

function Label({ item }: { item: Hotspot }) {
  return (
    <>
      <span className="hs-name">{item.name ?? item.file}</span>
      {item.name !== undefined && <span className="hs-where">{`${item.file}:${item.line}`}</span>}
      <span className="hs-numbers">{numbers(item)}</span>
    </>
  )
}

export default function HotspotsView({ show }: ViewProps) {
  const { currentRoot, codeMap, codeBusy, codeError } = useProject()
  const [level, setLevel] = useState<Level>('files')
  const [days, setDays] = useState<Days>('90')
  const [hovered, setHovered] = useState<string | null>(null)
  const read = useChurn(currentRoot, Number(days), codeMap)
  const shownDays = read?.churn?.days ?? Number(days)

  useEffect(() => {
    if (codeMap === null && !codeBusy && !codeError) rescan()
    else loadCodeMap()
  }, [currentRoot, codeMap, codeBusy, codeError])

  const items = useMemo(() => (codeMap && read?.churn ? rank(codeMap, read.churn, level) : null), [codeMap, read, level])
  const ranked = useMemo(() => (items ?? []).filter((item) => item.score > 0).slice(0, TOP), [items])
  const top = useMemo(() => new Set(ranked.map((item) => item.key)), [ranked])
  const most = useMemo(
    () => (items ?? []).reduce((m, item) => ({ lines: Math.max(m.lines, item.lines), commits: Math.max(m.commits, item.commits) }), { lines: 0, commits: 0 }),
    [items],
  )
  const shown = items?.find((item) => item.key === hovered) ?? null

  const showLatest = useRef(show)
  showLatest.current = show
  const onPick = useCallback(
    (item: Hotspot) => {
      if (item.name === undefined) {
        openFile(item.file)
        showLatest.current('files')
        return
      }
      const scope = storedScope(currentRoot)
      if (scope !== '' && !item.file.startsWith(`${scope}/`)) storeScope(currentRoot, '')
      storeFocus(currentRoot, keyOf({ file: item.file, line: item.line, name: item.name }))
      storeMode(currentRoot, 'focus')
      showLatest.current('functions')
    },
    [currentRoot],
  )

  if (!currentRoot) return null

  const unit = level === 'files' ? 'file' : 'function'
  return (
    <section className="hotspots">
      <header className="canvas-header">
        <h2>Hotspots</h2>
        <p className="canvas-path">{folderName(currentRoot)}</p>
      </header>

      <div className="fn-bar">
        <p className="fn-count" aria-live="polite">
          {read?.error ? 'Could not read git history' : codeMap === null || codeBusy ? 'Scanning…' : items === null ? 'Reading git history…' : plural(items.length, unit)}
        </p>
        <Choice label="Measure" keys={LEVELS} value={level} onPick={setLevel} />
        <Choice label="Window" keys={WINDOWS} value={days} onPick={setDays} />
      </div>

      {items && (
        <p className="hs-formula">
          <code>score = (lines ÷ {most.lines}) × (commits ÷ {most.commits})</code>, where {most.lines} lines and {most.commits} commits are the most of any {unit} in the last{' '}
          {shownDays} days.
        </p>
      )}

      {(read?.error || codeError) && (
        <p className="fn-notice" role="status">
          {read?.error ?? codeError}
        </p>
      )}
      {read?.churn?.incomplete && (
        <p className="fn-notice" role="status">
          Git history could not be read in full, so some counts may be low.
        </p>
      )}

      {items && (
        <>
          <p className="hs-readout" aria-live="polite">
            {shown ? <Label item={shown} /> : 'Hover a point for its numbers, click it to open.'}
          </p>
          <Scatter items={items} top={top} hovered={hovered} onHover={setHovered} onPick={onPick} />
          {ranked.length === 0 ? (
            <p className="fn-empty">Nothing changed in the last {shownDays} days.</p>
          ) : (
            <ol className="hs-list" aria-label={`Top ${ranked.length} by score`}>
              {ranked.map((item) => (
                <li key={item.key} className={item.key === hovered ? 'hovered' : undefined}>
                  <button onMouseEnter={() => setHovered(item.key)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(item.key)} onClick={() => onPick(item)}>
                    <Label item={item} />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  )
}
