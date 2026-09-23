import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  type Edge,
  type Node,
  type NodeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { CodeMap, SourceWindow } from '../../shared/types'
import {
  baseName,
  callPositions,
  codePositions,
  fileIndex,
  fnNodeId,
  folderIndex,
  functionEdges,
  functionNodes,
  widthOf,
  worldNodes,
  FUNCTIONS_SHOWN,
  type CodeNode,
  type CodeNodeData
} from '../model/codemap'
import { gotoSymbol, type Located, type SymbolRef } from '../model/goto'
import { outlineFor } from '../model/outline'
import { openFile } from '../model/store'
import { CodeInspector } from './Inspector'
import GotoPanel from './GotoPanel'
import Outline from './Outline'

type CodeCanvasProps = {
  map: CodeMap
  path: string
  theme: string
  onEnter: (path: string) => void
  onUp: () => void
}

const Picked = createContext<string | null>(null)
const Enter = createContext<(path: string) => void>(() => {})
const Goto = createContext<(ref: SymbolRef) => void>(() => {})

function card(kind: string, picked: boolean) {
  return picked ? `node code-node ${kind} picked` : `node code-node ${kind}`
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function plural(n: number, one: string) {
  return `${n} ${one}${n === 1 ? '' : 's'}`
}

function Open({ path, name }: { path: string; name: string }) {
  const enter = useContext(Enter)

  return (
    <button
      className="code-open"
      aria-label={`Open ${name}`}
      title={`Open ${name}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        enter(path)
      }}
    >
      ›
    </button>
  )
}

function FolderNode({ id, data }: NodeProps<Node<CodeNodeData>>) {
  const className = card('code-folder', useContext(Picked) === id)
  if (data.kind !== 'folder') return null
  return (
    <div className={className}>
      <div className="node-head">
        <span className="node-id">{data.name}</span>
        <span className="node-role">folder</span>
        <Open path={data.path} name={data.name} />
      </div>
      <div className="code-counts">
        {plural(data.counts.files, 'file')} · {plural(data.counts.functions, 'function')}
      </div>
    </div>
  )
}

function FileNode({ id, data }: NodeProps<Node<CodeNodeData>>) {
  const className = card('code-file', useContext(Picked) === id)
  if (data.kind !== 'codefile') return null
  const shown = data.functions.slice(0, FUNCTIONS_SHOWN)
  const hidden = data.functions.length - shown.length

  return (
    <div className={className}>
      <div className="node-head">
        <span className="node-id">{data.name}</span>
        <span className="node-role">file</span>
        <Open path={data.path} name={data.name} />
      </div>
      {data.functions.length === 0 ? (
        <div className="code-note">no functions</div>
      ) : (
        <div className="code-fns">
          {shown.map((fn, i) => (
            <div key={`${i}:${fn.name}`} className="code-fn">
              <span className="code-fn-name">{fn.name}</span>
              {fn.description !== '' && <span className="code-fn-desc">{fn.description}</span>}
            </div>
          ))}
        </div>
      )}
      {hidden > 0 && <div className="code-note">+{hidden} more</div>}
    </div>
  )
}

function GotoButton({ path, index, name }: { path: string; index: number; name: string }) {
  const goto = useContext(Goto)

  return (
    <button
      className="code-open"
      aria-label={`Show definition and references for ${name}`}
      title="Definition and references"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        goto({ file: path, index })
      }}
    >
      ⌕
    </button>
  )
}

function FunctionNode({ id, data }: NodeProps<Node<CodeNodeData>>) {
  const picked = useContext(Picked) === id
  if (data.kind !== 'codefn') return null

  const className = card(data.external ? 'code-fnnode code-fnout' : 'code-fnnode', picked)

  return (
    <div className={className}>
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <div className="node-head">
        <span className="node-id code-fn-name">{data.name}</span>
        <span className="node-role">
          {data.external ? baseName(data.path) : `${data.line}–${data.endLine}`}
        </span>
        <GotoButton path={data.path} index={data.index} name={data.name} />
        {data.external && <Open path={data.path} name={baseName(data.path)} />}
      </div>
      {data.description !== '' && <div className="code-fn-desc code-fn-lead">{data.description}</div>}
    </div>
  )
}

const nodeTypes = {
  folder: FolderNode,
  codefile: FileNode,
  codefn: FunctionNode
}

function toFlow(logical: CodeNode[], at: Map<string, { x: number; y: number }>): Node<CodeNodeData>[] {
  return logical.map((n) => ({
    id: n.id,
    type: n.data.kind,
    draggable: false,
    deletable: false,
    position: at.get(n.id) ?? { x: 0, y: 0 },
    style: { width: widthOf(n.data), height: n.height },
    data: n.data
  }))
}

export default function CodeCanvas({ map, path, theme, onEnter, onUp }: CodeCanvasProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [source, setSource] = useState<SourceWindow | null>(null)
  const [gotoRef, setGotoRef] = useState<SymbolRef | null>(null)
  const stage = useRef<HTMLDivElement | null>(null)
  const pendingSelect = useRef<string | null>(null)

  const colors = useMemo(() => ({ dots: cssVar('--dots'), ink: cssVar('--ink') }), [theme])
  const outline = useMemo(() => outlineFor(map, path), [map, path])
  const returnFocus = useCallback(() => stage.current?.focus(), [])

  const index = useMemo(() => fileIndex(map), [map])
  const file = useMemo(() => index.get(path) ?? null, [index, path])

  const world = useMemo(() => {
    if (file) {
      const logical = functionNodes(file, index)
      const links = functionEdges(file, index)
      return { nodes: toFlow(logical, callPositions(logical, links)), links }
    }
    const logical = worldNodes(folderIndex(map), path)
    return { nodes: toFlow(logical, codePositions(logical)), links: [] }
  }, [map, path, file, index])

  const edges = useMemo<Edge[]>(
    () =>
      world.links.map((l) => ({
        id: l.id,
        source: l.source,
        target: l.target,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 15,
          height: 15,
          color: colors.ink
        },
        style: { stroke: colors.ink, strokeWidth: 1.4 }
      })),
    [world, colors]
  )

  useEffect(() => {
    setSelectedId(pendingSelect.current)
    pendingSelect.current = null
  }, [path])

  const selected = world.nodes.find((n) => n.id === selectedId)?.data ?? null

  useEffect(() => {
    setSource(null)
    if (selected === null || selected.kind !== 'codefn') return

    let live = true
    window.architect
      .readSource(map.root, selected.path, selected.line, selected.endLine - selected.line + 1)
      .then((window) => {
        if (live) setSource(window)
      })
      .catch(() => {
        if (live) setSource({ from: selected.line, lines: [], total: 0, error: 'unreadable' })
      })

    return () => {
      live = false
    }
  }, [map.root, selected])

  const gotoResult = useMemo(() => (gotoRef ? gotoSymbol(map, gotoRef) : null), [map, gotoRef])

  const jumpGoto = useCallback(
    (item: Located) => {
      setGotoRef(null)
      openFile(item.file, item.line)
      const id = fnNodeId(item.file, item.index, item.name)
      if (item.file === path) {
        setSelectedId(id)
        return
      }
      pendingSelect.current = id
      onEnter(item.file)
    },
    [path, onEnter]
  )

  const close = useCallback(() => setSelectedId(null), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (selectedId) close()
      else onUp()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, close, onUp])

  return (
    <div className="canvas-stage" ref={stage} tabIndex={-1}>
      {file && (
        <Outline
          entries={outline}
          currentId={selectedId}
          onSelect={setSelectedId}
          onGoto={setGotoRef}
          returnFocus={returnFocus}
        />
      )}
      <Picked.Provider value={selectedId}>
        <Enter.Provider value={onEnter}>
          <Goto.Provider value={setGotoRef}>
            <ReactFlow
              key={path}
              nodes={world.nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              zoomOnDoubleClick={false}
              fitView
              fitViewOptions={{ padding: 0.14 }}
              minZoom={0.1}
              proOptions={{ hideAttribution: true }}
              onNodeClick={(_event, node) => setSelectedId(node.id)}
              onNodeDoubleClick={(_event, node) => {
                if (node.data.kind !== 'codefn' || node.data.external) onEnter(node.data.path)
              }}
              onPaneClick={close}
            >
              <Background gap={26} size={1} color={colors.dots} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </Goto.Provider>
        </Enter.Provider>
      </Picked.Provider>
      {world.nodes.length === 0 && (
        <div className="empty-state code-empty">
          {file ? 'This file has no functions' : 'No code here yet'}
        </div>
      )}
      {selected && <CodeInspector key={selectedId} node={selected} source={source} onClose={close} />}
      {gotoResult && (
        <GotoPanel root={map.root} result={gotoResult} onClose={() => setGotoRef(null)} onJump={jumpGoto} />
      )}
    </div>
  )
}
