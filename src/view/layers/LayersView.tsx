import { useCallback, useEffect, useRef, useState } from 'react'
import type { LayerCell } from '../../../shared/types'
import { folderName } from '../../model/layout'
import { loadCodeMap, openFile, useProject } from '../../model/store'
import type { ViewProps } from '../../shell/views'
import Calls, { STATUS_LABEL } from './Calls'
import Matrix from './Matrix'
import { useLayers } from './useLayers'

export default function LayersView({ show }: ViewProps) {
  const { currentRoot, codeMap, architecture } = useProject()
  const { layers, error } = useLayers(currentRoot, codeMap, architecture)
  const [pair, setPair] = useState<{ from: string; to: string } | null>(null)
  const picked = layers?.cells.find((cell) => cell.from === pair?.from && cell.to === pair.to) ?? null

  useEffect(() => {
    loadCodeMap()
  }, [currentRoot, codeMap])

  useEffect(() => {
    setPair(null)
  }, [currentRoot])

  const showLatest = useRef(show)
  showLatest.current = show
  const onOpen = useCallback((file: string, line: number) => {
    openFile(file, line)
    showLatest.current('files')
  }, [])
  const onPick = useCallback(({ from, to }: LayerCell) => setPair({ from, to }), [])

  if (!currentRoot) return null
  const statuses = layers?.contract ? (['allowed', 'forbidden', 'undrawn', 'stale'] as const) : (['free'] as const)

  return (
    <section className="layers">
      <header className="canvas-header">
        <h2>Layers</h2>
        <p className="canvas-path">{folderName(currentRoot)}</p>
      </header>

      <div className="layers-bar">
        <span className="layers-source">{layers?.contract ? 'architect.md components' : 'top level folders, no architect.md'}</span>
        {statuses.map((status) => (
          <span key={status} className={`layers-tag ${status}`}>
            {STATUS_LABEL[status]}
          </span>
        ))}
        <span className="layers-tag cycle">cycle</span>
      </div>

      {error && (
        <p className="fn-notice" role="status">
          {error}
        </p>
      )}

      {layers && layers.rows.length === 0 ? (
        <p className="fn-empty">No components found in this project.</p>
      ) : (
        layers && (
          <div className="layers-body">
            <Matrix layers={layers} picked={picked} onPick={onPick} />
            {picked && <Calls cell={picked} onOpen={onOpen} onClose={() => setPair(null)} />}
          </div>
        )
      )}
    </section>
  )
}
