import { useCallback, useEffect, useRef, useState } from 'react'
import type { FlowAsk } from '../../../shared/types'
import { folderName } from '../../model/layout'
import { loadCodeMap, openFile, useProject } from '../../model/store'
import type { ViewProps } from '../../shell/views'
import { useFunctions } from '../functions/useFunctions'
import { REASON } from '../functions/tree/outline'
import Diagram from './Diagram'
import Picker from './Picker'
import { useFlow } from './useFlow'

const DEPTH = 3
const DEEPEST = 64

export default function FlowView({ show }: ViewProps) {
  const { currentRoot, codeMap, codeError, architecture } = useProject()
  const { list, error: listError } = useFunctions(currentRoot, codeMap, '')
  const [picked, setPicked] = useState<{ file: string; name: string; line: number } | null>(null)
  const [depth, setDepth] = useState(DEPTH)
  const [open, setOpen] = useState<string[]>([])
  const ask: FlowAsk | null = picked ? { ...picked, depth, open } : null
  const { flow, error } = useFlow(currentRoot, codeMap, architecture, ask)
  const at =
    picked && list
      ? list.rows.findIndex((row) => row.file === picked.file && row.name === picked.name && row.line === picked.line)
      : -1

  useEffect(() => {
    loadCodeMap()
  }, [currentRoot, codeMap])

  useEffect(() => {
    setPicked(null)
    setOpen([])
  }, [currentRoot])

  const showLatest = useRef(show)
  showLatest.current = show
  const onOpen = useCallback((file: string, line: number) => {
    openFile(file, line)
    showLatest.current('files')
  }, [])
  const onExpand = useCallback((key: string) => setOpen((keys) => (keys.includes(key) ? keys : [...keys, key])), [])
  const onPick = (index: number | null) => {
    const row = index === null ? undefined : list?.rows[index]
    setPicked(row ? { file: row.file, name: row.name, line: row.line } : null)
    setOpen([])
  }

  if (!currentRoot) return null
  const problem = codeError ?? listError ?? error

  return (
    <section className="flow">
      <header className="canvas-header">
        <h2>Flow</h2>
        <p className="canvas-path">{folderName(currentRoot)}</p>
      </header>

      <div className="flow-bar">
        {list ? (
          <Picker list={list} picked={at === -1 ? null : at} onPick={onPick} />
        ) : (
          <span className="flow-note">Reading functions…</span>
        )}
        <div className="flow-depth" role="group" aria-label="Depth">
          <span>Depth {depth}</span>
          <button type="button" aria-label="Shallower" disabled={depth <= 1} onClick={() => setDepth((d) => Math.max(1, d - 1))}>
            −
          </button>
          <button
            type="button"
            aria-label="Deeper"
            disabled={depth >= DEEPEST}
            onClick={() => setDepth((d) => Math.min(DEEPEST, d + 1))}
          >
            +
          </button>
        </div>
        <span className="flow-tag forbidden">forbidden by architect.md</span>
        <span className="flow-tag ipc">ipc hop</span>
        <span className="flow-tag more">+ expand</span>
      </div>

      <p className="flow-note">
        Static calls from the scan, in the order they appear in the source. Dynamic dispatch, callbacks and calls across processes
        are not followed, except a renderer call through the preload bridge whose channel the scan matches to an ipcMain handler.
      </p>

      {problem && (
        <p className="fn-notice" role="status">
          {problem}
        </p>
      )}

      {flow && (
        <p className="flow-note">
          {`${flow.start} · ${REASON[flow.entry.reason]} in ${flow.entry.file} · lifelines are ${flow.contract ? 'architect.md components' : 'top level folders'} · ${flow.steps.length} calls`}
          {flow.cut && ' · stopped early, the diagram is at its size limit'}
        </p>
      )}

      <div className="flow-body">
        {flow && flow.steps.length === 0 && <p className="fn-empty">The scan found no calls from {flow.start}.</p>}
        {flow && flow.steps.length > 0 && <Diagram flow={flow} onOpen={onOpen} onExpand={onExpand} />}
        {!picked && list && <p className="fn-empty">Pick a starting point to draw its calls.</p>}
      </div>
    </section>
  )
}
