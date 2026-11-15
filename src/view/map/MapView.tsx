import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadCodeMap, openFile, useProject } from '../../model/store'
import type { ViewProps } from '../../shell/views'
import Treemap from './canvas/Treemap'
import { factsFor } from './facts'
import type { MapNode } from './layout/nest'
import { trail } from './layout/trail'
import Legend from './modes/Legend'
import Breakdown from './style/Breakdown'
import { MODES } from './modes/palette'
import { churnTop, type ModeId, shade } from './modes/shade'
import { useMap } from './useMap'
import { keep, recall } from '../remember/slot'
import { zoomKey, zoomOf } from '../remember/zoom'

const lensOf = (root: string | null): ModeId => MODES.find(({ id }) => id === recall('map', 'lens', root))?.id ?? 'importance'

export default function MapView({ theme, show }: ViewProps) {
  const { currentRoot, codeMap, codeError } = useProject()
  const { tree, facts, error, churnError, styleError, grouped } = useMap()
  const [modeId, setModeId] = useState<ModeId>(() => lensOf(currentRoot))
  const [focusId, setFocusId] = useState('')
  const mode = MODES.find(({ id }) => id === modeId) ?? (MODES[0] as (typeof MODES)[number])

  useEffect(() => {
    loadCodeMap()
  }, [currentRoot, codeMap])

  useEffect(() => {
    setFocusId('')
    setModeId(lensOf(currentRoot))
  }, [currentRoot])

  useEffect(() => {
    if (tree) setFocusId(zoomOf(tree, recall('map', 'zoom', currentRoot)))
  }, [currentRoot, tree !== null])

  const zoom = useCallback(
    (node: MapNode) => {
      setFocusId(node.id)
      keep('map', 'zoom', currentRoot, zoomKey(node))
    },
    [currentRoot],
  )
  const lens = useCallback(
    (id: ModeId) => {
      setModeId(id)
      keep('map', 'lens', currentRoot, id)
    },
    [currentRoot],
  )

  const path = useMemo(() => {
    if (!tree) return []
    const found = trail(tree, focusId)
    return found.length > 0 ? found : [tree]
  }, [tree, focusId])
  const focus = path[path.length - 1]

  const values = useMemo(
    () => (tree && facts ? shade(tree, modeId, facts) : new Map<string, number | null>()),
    [tree, facts, modeId],
  )
  const describe = useCallback(
    (node: MapNode) => (facts ? factsFor(node, facts) : { kind: '', title: '', lines: [] }),
    [facts],
  )
  const busiest = useMemo(() => (tree && facts?.churn ? churnTop(tree, facts) : null), [tree, facts])

  const open = useCallback(
    (file: string, line?: number) => {
      openFile(file, line)
      show('code')
    },
    [show],
  )

  const pick = useCallback(
    (node: MapNode) => {
      const row = node.fn === undefined ? undefined : facts?.rows[node.fn]
      if (node.kind === 'rest') {
        openFile(node.path)
        return show('code')
      }
      if (!row) return zoom(node)
      openFile(row.file, row.line)
      show('code')
    },
    [facts, show, zoom],
  )

  const notice =
    codeError ??
    error ??
    (modeId !== 'churn'
      ? null
      : churnError
        ? `Churn could not be read: ${churnError}`
        : facts?.churn === null
          ? 'Reading churn from git…'
          : facts?.churn?.incomplete
            ? 'Git could not finish reading the history, so churn is partial.'
            : null)

  return (
    <section className="map" aria-label="Map" data-lens={modeId} data-zoom={tree ? focus?.path : undefined}>
      <div className="fn-bar">
        <nav className="map-trail" aria-label="Zoom">
          {path.map((node, at) => (
            <span key={node.id || 'root'}>
              {at > 0 && <span className="map-sep">/</span>}
              <button className="map-crumb" disabled={at === path.length - 1} onClick={() => zoom(node)}>
                {node.label || 'project'}
              </button>
            </span>
          ))}
        </nav>
        <Legend
          mode={mode}
          high={modeId === 'churn' && busiest !== null ? `${busiest} commits` : undefined}
          onMode={lens}
        />
      </div>
      {notice && <p className="fn-notice">{notice}</p>}
      {!tree ? (
        !notice && <p className="fn-empty">Reading functions…</p>
      ) : !focus || focus.children.length === 0 ? (
        <p className="fn-empty">No functions found.</p>
      ) : (
        <>
          <p className="map-grouped">
            Grouped by {grouped === 'components' ? 'contract component' : 'package, or top level folder outside one'}, then folder, file and
            function. Click a tile to zoom in, or a function to open it. Scroll to zoom, drag to pan, press 0 to fit.
          </p>
          <div className="map-body">
            <Treemap focus={focus} values={values} token={mode.token} theme={theme} describe={describe} onPick={pick} />
            {modeId === 'style' && (
              <Breakdown path={path} style={facts?.style ?? null} error={styleError} onOpen={open} />
            )}
          </div>
        </>
      )}
    </section>
  )
}
