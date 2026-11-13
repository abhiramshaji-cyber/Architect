import { useCallback, useEffect, useMemo, useState } from 'react'
import { folderName } from '../../model/layout'
import { loadCodeMap, openFile, useProject } from '../../model/store'
import { HISTORY_LIMIT } from '../../../shared/types'
import type { ViewProps } from '../../shell/views'
import { Choice } from '../functions/bar/Bar'
import { plural } from '../functions/Mark'
import Treemap from '../map/canvas/Treemap'
import { factsFor } from '../map/facts'
import type { MapNode } from '../map/layout/nest'
import { useMap } from '../map/useMap'
import Readout, { Verdicts, when } from './Readout'
import { light } from './timeline/light'
import { stepsOf } from './timeline/steps'
import { type Recorded, recordedFrom } from './timeline/recorded'
import { stepAt, verdictsAt } from './timeline/verdicts'
import Track from './Track'
import { LIMIT, useReplay } from './useReplay'

type Days = '30' | '90' | '365'

const WINDOWS: { key: Days; label: string }[] = [
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: '365', label: '365 days' },
]

const PLAY_MS = 700

const KEPT: Record<Recorded['by'], string> = {
  history: `The change history is at its limit of ${HISTORY_LIMIT} entries, so code and contract changes before`,
  verdicts: `The verdict record is at its limit of ${HISTORY_LIMIT} verdicts, so check_change verdicts before`,
}

export default function ReplayView({ theme, show }: ViewProps) {
  const { currentRoot, codeMap, history } = useProject()
  const { tree, facts, error } = useMap()
  const [days, setDays] = useState<Days>('90')
  const [picked, setPicked] = useState<{ key: string; at: number } | null>(null)
  const [playing, setPlaying] = useState(false)
  const stored = useReplay(currentRoot, Number(days))

  const recorded = useMemo(() => (stored ? recordedFrom(history, stored.verdicts) : null), [stored, history])
  const steps = useMemo(() => (stored ? stepsOf(stored.commits, history, stored.since) : []), [stored, history])
  const filed = useMemo(() => verdictsAt(steps, stored?.verdicts ?? [], stored?.since ?? Infinity), [steps, stored])
  const last = steps.length - 1
  const found = picked ? steps.findIndex((item) => item.key === picked.key) : -1
  const at = !picked ? last : found >= 0 ? found : stepAt(steps, picked.at)
  const go = (index: number) => {
    const target = steps[index]
    if (target) setPicked({ key: target.key, at: target.at })
  }
  const lit = useMemo(() => (tree ? light(tree, steps, at) : null), [tree, steps, at])

  useEffect(() => {
    loadCodeMap()
  }, [currentRoot, codeMap])

  useEffect(() => {
    setPicked(null)
    setPlaying(false)
  }, [currentRoot, days])

  useEffect(() => {
    if (!playing) return
    if (at >= last) return setPlaying(false)
    const next = steps[at + 1]
    const timer = setTimeout(() => next && setPicked({ key: next.key, at: next.at }), PLAY_MS)
    return () => clearTimeout(timer)
  }, [playing, at, last, steps])

  const open = useCallback(
    (file: string, line?: number) => {
      openFile(file, line)
      show('code')
    },
    [show],
  )

  const describe = useCallback((node: MapNode) => (facts ? factsFor(node, facts) : { kind: '', title: '', lines: [] }), [facts])

  const pick = useCallback(
    (node: MapNode) => {
      const row = node.fn === undefined ? undefined : facts?.rows[node.fn]
      if (row) open(row.file, row.line)
      else if (node.kind === 'rest' || node.kind === 'file') open(node.path)
    },
    [facts, open],
  )

  if (!currentRoot) return null

  const count = (kind: string) => steps.filter((step) => step.kind === kind).length
  const rejected = filed.steps.reduce((sum, { rejected }) => sum + rejected.length, filed.before.rejected.length)
  const step = steps[at]

  return (
    <section className="replay" aria-label="Replay">
      <header className="canvas-header">
        <h2>Replay</h2>
        <p className="canvas-path">{folderName(currentRoot)}</p>
      </header>

      <div className="fn-bar">
        <p className="fn-count" aria-live="polite">
          {!stored
            ? 'Reading git history…'
            : `${plural(steps.length, 'step')}: ${plural(count('commit'), 'commit')}, ${plural(count('code'), 'code change')}, ${plural(count('contract'), 'contract change')}, ${plural(rejected, 'rejected verdict')}`}
        </p>
        <div className="fn-sort" role="group" aria-label="Play">
          <button className="cyber-btn cyber-btn--sm cyber-btn--ghost" disabled={at <= 0} onClick={() => go(at - 1)}>
            Back
          </button>
          <button
            className={playing ? 'cyber-btn cyber-btn--sm cyber-btn--filled' : 'cyber-btn cyber-btn--sm cyber-btn--ghost'}
            aria-pressed={playing}
            disabled={steps.length < 2}
            onClick={() => {
              if (!playing && at >= last) go(0)
              setPlaying(!playing)
            }}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <button className="cyber-btn cyber-btn--sm cyber-btn--ghost" disabled={at >= last} onClick={() => go(at + 1)}>
            Next
          </button>
        </div>
        <Choice label="Window" keys={WINDOWS} value={days} onPick={setDays} />
      </div>

      {stored?.error && <p className="fn-notice">{stored.error}</p>}
      {error && <p className="fn-notice">{error}</p>}
      {stored?.capped && (
        <p className="fn-notice">
          Showing the newest {LIMIT.toLocaleString()} commits of the window, back to {when(stored.since)}.
        </p>
      )}
      {recorded && steps[0] && recorded.at > Math.max(stored?.since ?? 0, steps[0].at) && (
        <p className="fn-notice">
          {KEPT[recorded.by]} {when(recorded.at)} may be missing; the shaded part of the timeline is before it.
        </p>
      )}

      {stored && steps.length === 0 ? (
        <div className="replay-readout">
          <p className="fn-empty">No commits or recorded changes in the last {days} days.</p>
          <Verdicts title="check_change verdicts in the window" held={filed.before} />
        </div>
      ) : (
        <>
          <div className="replay-body">
            {tree && lit ? (
              <Treemap focus={tree} values={lit.values} token="--live" theme={theme} describe={describe} onPick={pick} />
            ) : (
              <p className="fn-empty">Reading functions…</p>
            )}
            {step && filed.steps[at] && (
              <Readout
                step={step}
                index={at}
                total={steps.length}
                held={filed.steps[at]}
                before={at === 0 ? filed.before : undefined}
                found={lit?.found ?? 0}
                onOpen={open}
              />
            )}
          </div>
          <p className="map-grouped">
            Strong tiles changed at this step, faint tiles at an earlier step of the timeline. Red marks are rejected check_change
            verdicts.
          </p>
          <Track
            steps={steps}
            at={at}
            filed={filed}
            recorded={recorded?.at ?? null}
            onAt={(next) => {
              setPlaying(false)
              go(next)
            }}
          />
        </>
      )}
    </section>
  )
}
