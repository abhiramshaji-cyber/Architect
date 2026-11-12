import { useCallback, useEffect, useMemo, useState } from 'react'
import { folderName } from '../../model/layout'
import { loadCodeMap, openFile, useProject } from '../../model/store'
import type { ViewProps } from '../../shell/views'
import { Choice } from '../functions/bar/Bar'
import { plural } from '../functions/Mark'
import Treemap from '../map/canvas/Treemap'
import { factsFor } from '../map/facts'
import type { MapNode } from '../map/layout/nest'
import { useMap } from '../map/useMap'
import Readout, { stepText, verdictText, when } from './Readout'
import { light } from './timeline/light'
import { stepsOf } from './timeline/steps'
import { verdictsAt } from './timeline/verdicts'
import Track from './Track'
import { LIMIT, useReplay } from './useReplay'

type Days = '30' | '90' | '365'

const WINDOWS: { key: Days; label: string }[] = [
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: '365', label: '365 days' },
]

const PLAY_MS = 700

export default function ReplayView({ theme, show }: ViewProps) {
  const { currentRoot, codeMap, history } = useProject()
  const { tree, facts, error } = useMap()
  const [days, setDays] = useState<Days>('90')
  const [picked, setPicked] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const stored = useReplay(currentRoot, Number(days), history)

  const steps = useMemo(() => (stored ? stepsOf(stored.commits, history, stored.since) : []), [stored, history])
  const held = useMemo(() => (stored ? verdictsAt(steps, stored.verdicts, stored.since) : []), [steps, stored])
  const last = steps.length - 1
  const at = picked === null ? last : Math.min(picked, last)
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
    const timer = setTimeout(() => setPicked(at + 1), PLAY_MS)
    return () => clearTimeout(timer)
  }, [playing, at, last])

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
  const rejected = held.reduce((sum, { rejected }) => sum + rejected.length, 0)
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
          <button className="mode" disabled={at <= 0} onClick={() => setPicked(at - 1)}>
            Back
          </button>
          <button
            className={playing ? 'mode active' : 'mode'}
            aria-pressed={playing}
            disabled={steps.length < 2}
            onClick={() => {
              if (!playing && at >= last) setPicked(0)
              setPlaying(!playing)
            }}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <button className="mode" disabled={at >= last} onClick={() => setPicked(at + 1)}>
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

      {stored && steps.length === 0 ? (
        <p className="fn-empty">No commits or recorded changes in the last {days} days.</p>
      ) : (
        <>
          <div className="replay-body">
            {tree && lit ? (
              <Treemap focus={tree} values={lit.values} token="--live" theme={theme} describe={describe} onPick={pick} />
            ) : (
              <p className="fn-empty">Reading functions…</p>
            )}
            {step && held[at] && (
              <Readout step={step} index={at} total={steps.length} held={held[at]} found={lit?.found ?? 0} onOpen={open} />
            )}
          </div>
          <p className="map-grouped">
            Strong tiles changed at this step, faint tiles changed earlier in the window. Red marks are rejected check_change
            verdicts.
          </p>
          <Track
            steps={steps}
            at={at}
            held={held}
            onAt={(next) => {
              setPlaying(false)
              setPicked(next)
            }}
          />
        </>
      )}
    </section>
  )
}
