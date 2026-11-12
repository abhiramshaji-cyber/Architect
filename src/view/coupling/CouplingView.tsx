import { useCallback, useEffect, useRef, useState } from 'react'
import type { CouplingAsk } from '../../../shared/types'
import { folderName } from '../../model/layout'
import { loadCodeMap, openFile, rescan, useProject } from '../../model/store'
import type { ViewProps } from '../../shell/views'
import { Choice } from '../functions/bar/Bar'
import { plural } from '../functions/Mark'
import Field from './Field'
import Pair from './Pair'
import { useCoupling } from './useCoupling'

type Days = '30' | '90' | '365'

const WINDOWS: { key: Days; label: string }[] = [
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: '365', label: '365 days' },
]

const day = (at: number) => new Date(at).toISOString().slice(0, 10)

export default function CouplingView({ show }: ViewProps) {
  const { currentRoot, codeMap, codeBusy, codeError } = useProject()
  const [days, setDays] = useState<Days>('90')
  const [minShared, setMinShared] = useState(3)
  const [confidence, setConfidence] = useState(50)
  const [maxFiles, setMaxFiles] = useState(30)
  const ask: CouplingAsk = { days: Number(days), minShared, minConfidence: confidence / 100, maxFiles }
  const read = useCoupling(currentRoot, ask, codeMap)
  const coupling = read?.coupling ?? null

  useEffect(() => {
    if (codeMap === null && !codeBusy && !codeError) rescan()
    else loadCodeMap()
  }, [currentRoot, codeMap, codeBusy, codeError])

  const showLatest = useRef(show)
  showLatest.current = show
  const onOpen = useCallback((file: string) => {
    openFile(file)
    showLatest.current('files')
  }, [])

  if (!currentRoot) return null

  const error = read?.error ?? (codeMap ? null : codeError)
  return (
    <section className="coupling">
      <header className="canvas-header">
        <h2>Coupling</h2>
        <p className="canvas-path">{folderName(currentRoot)}</p>
      </header>

      <div className="fn-bar">
        <p className="fn-count" aria-live="polite">
          {error ? 'Could not read coupling' : codeMap === null || codeBusy ? 'Scanning…' : coupling ? plural(coupling.pairs.length, 'pair') : 'Reading git history…'}
        </p>
        <Choice label="Window" keys={WINDOWS} value={days} onPick={setDays} />
        <Field label="Shared at least" value={minShared} min={1} max={100_000} onValue={setMinShared} />
        <Field label="Confidence at least %" value={confidence} min={0} max={100} onValue={setConfidence} />
        <Field label="Skip commits over N files" value={maxFiles} min={2} max={1000} onValue={setMaxFiles} />
      </div>

      {error && (
        <p className="fn-notice" role="status">
          {error}
        </p>
      )}

      {coupling && (
        <>
          <p className="cp-note">
            Pairs of files changed together with no import either way, directly or through a re-export. <code>confidence = shared ÷ the fewer changes of the two</code>. A pair
            shows when its commits or its sessions reach {plural(coupling.ask.minShared, 'shared change')} and {Math.round(coupling.ask.minConfidence * 100)}% confidence.
          </p>
          <p className="cp-note">
            {plural(coupling.skipped, 'commit')} touching more than {coupling.ask.maxFiles} files in the last {coupling.ask.days} days {coupling.skipped === 1 ? 'is' : 'are'}{' '}
            skipped. Sessions come from Architect’s change history
            {coupling.historyFrom === null ? ', which is empty for this project.' : `, which reaches back to ${day(coupling.historyFrom)}.`}
          </p>
          {coupling.pairs.length === 0 ? (
            <p className="fn-empty">No pairs reach these thresholds.</p>
          ) : (
            <ol className="cp-list">
              {coupling.pairs.map((pair) => (
                <Pair key={pair.files.join('\0')} pair={pair} coupling={coupling} onOpen={onOpen} />
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  )
}
