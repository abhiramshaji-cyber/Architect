import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import type { Architecture } from '../../shared/types'
import { hangingIndent, type CodeNodeData, type FnRef } from '../model/codemap'
import { renameComponent, setOwns, setPurpose, type OpResult } from '../model/edit-ops'
import { clampInspectorWidth, statusOf, INSPECTOR_W, type NodeData } from '../model/layout'

const WIDTH_KEY = 'architect.inspector.width'

function storedWidth(): number {
  try {
    const saved = localStorage.getItem(WIDTH_KEY)
    return saved === null ? INSPECTOR_W : Number(saved)
  } catch {
    return INSPECTOR_W
  }
}

function useWidth() {
  const panel = useRef<HTMLElement | null>(null)
  const want = useRef(storedWidth())
  const release = useRef<() => void>(() => {})
  const [width, setWidth] = useState(INSPECTOR_W)

  const stage = useCallback(() => panel.current?.parentElement?.clientWidth ?? window.innerWidth, [])

  useLayoutEffect(() => {
    const refit = () => setWidth(clampInspectorWidth(want.current, stage()))
    refit()
    window.addEventListener('resize', refit)
    return () => {
      window.removeEventListener('resize', refit)
      release.current()
    }
  }, [stage])

  const grab = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()

    const grip = e.currentTarget
    grip.setPointerCapture(e.pointerId)

    const move = (ev: PointerEvent) => {
      const edge = panel.current?.getBoundingClientRect().right ?? window.innerWidth
      want.current = edge - ev.clientX
      setWidth(clampInspectorWidth(want.current, stage()))
    }

    const stop = () => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', stop)
      grip.removeEventListener('pointercancel', stop)
      grip.removeEventListener('lostpointercapture', stop)
      document.body.classList.remove('resizing')
      release.current = () => {}
      try {
        localStorage.setItem(WIDTH_KEY, String(clampInspectorWidth(want.current, stage())))
      } catch {
        return
      }
    }

    release.current = stop
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', stop)
    grip.addEventListener('pointercancel', stop)
    grip.addEventListener('lostpointercapture', stop)
    document.body.classList.add('resizing')
  }

  return { panel, width, grab }
}

function Listing({ text, from, last }: { text: string; from: number; last: number }) {
  const lines = text.replace(/\n$/, '').split('\n')
  const gutter = `${String(Math.max(last, from + lines.length - 1)).length}ch`

  return (
    <div className="inspector-src">
      {lines.map((line, i) => (
        <div key={i} className="inspector-src-line">
          <span className="inspector-src-no" style={{ width: gutter }}>
            {from + i}
          </span>
          <span
            className="inspector-src-text"
            style={{
              paddingLeft: `${hangingIndent(line)}ch`,
              textIndent: `-${hangingIndent(line)}ch`
            }}
          >
            {line === '' ? ' ' : line}
          </span>
        </div>
      ))}
    </div>
  )
}

function Grip({ onGrab }: { onGrab: (e: React.PointerEvent<HTMLDivElement>) => void }) {
  return (
    <div className="inspector-grip" role="separator" aria-orientation="vertical" onPointerDown={onGrab} />
  )
}

type InspectorProps = {
  node: NodeData
  onClose: () => void
  onSelect: (id: string | null) => void
  onEdit?: (op: (a: Architecture) => OpResult) => boolean
  onDrop?: (id: string) => void
}

const KINDS = { folder: 'folder', codefile: 'file', codefn: 'function' } as const

function Names({ title, refs, home }: { title: string; refs: FnRef[]; home: string }) {
  return (
    <section className="inspector-section">
      <h3>{title}</h3>
      {refs.length === 0 ? (
        <p className="inspector-purpose">None</p>
      ) : (
        <ul className="inspector-owns">
          {refs.map((ref) => (
            <li key={`${ref.file}#${ref.index}`} className="code-fn-name">
              {ref.file === home ? ref.name : `${ref.name} · ${ref.file}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function CodeInspector({
  node,
  source,
  onClose
}: {
  node: CodeNodeData
  source?: string | null
  onClose: () => void
}) {
  const { panel, width, grab } = useWidth()

  return (
    <>
      <Grip onGrab={grab} />
      <aside ref={panel} className="inspector" style={{ width }}>
        <div className="inspector-head">
          <div className="inspector-title">
            <span className="inspector-id">{node.name}</span>
            <span className="inspector-status">{KINDS[node.kind]}</span>
          </div>
          <button className="inspector-close" onClick={onClose} aria-label="Close inspector">
            ×
          </button>
        </div>

        <section className="inspector-section">
          <h3>Path</h3>
          <p className="inspector-purpose">{node.path === '' ? '/' : node.path}</p>
        </section>

        {node.kind === 'folder' ? (
          <section className="inspector-section">
            <h3>Contents</h3>
            <p className="inspector-purpose">
              {node.counts.files} files · {node.counts.functions} functions
            </p>
          </section>
        ) : node.kind === 'codefn' ? (
          <>
            <section className="inspector-section">
              <h3>Lines</h3>
              <p className="inspector-purpose">
                {node.line}–{node.endLine}
              </p>
            </section>

            {node.description !== '' && (
              <section className="inspector-section">
                <h3>Description</h3>
                <p className="inspector-purpose">{node.description}</p>
              </section>
            )}

            <Names title="Calls" refs={node.calls} home={node.path} />
            <Names title="Called by" refs={node.callers} home={node.path} />

            <section className="inspector-section">
              <h3>Source</h3>
              {source === null || source === undefined ? (
                <p className="inspector-purpose">Loading source…</p>
              ) : source === '' ? (
                <p className="inspector-purpose">Source unavailable</p>
              ) : (
                <Listing text={source} from={node.line} last={node.endLine} />
              )}
            </section>
          </>
        ) : (
          <section className="inspector-section">
            <h3>Functions</h3>
            {node.functions.length === 0 ? (
              <p className="inspector-purpose">No functions in this file</p>
            ) : (
              <ul className="inspector-fns">
                {node.functions.map((fn, i) => (
                  <li key={`${i}:${fn.name}`}>
                    <div className="inspector-fn-head">
                      <span className="code-fn-name">{fn.name}</span>
                      <span className="inspector-fn-line">line {fn.line}</span>
                    </div>
                    {fn.description !== '' && <p className="inspector-fn-desc">{fn.description}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </aside>
    </>
  )
}

export default function Inspector({ node, onClose, onSelect, onEdit, onDrop }: InspectorProps) {
  const [pass, setPass] = useState(0)
  const { panel, width, grab } = useWidth()

  const edit = node.kind === 'component' && !node.ghost ? onEdit : undefined
  const owned = node.owns.join('\n')

  const commit = (op: (a: Architecture) => OpResult) => (edit ? edit(op) : false)

  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur()
  }

  return (
    <>
      <Grip onGrab={grab} />
      <aside ref={panel} className="inspector" style={{ width }}>
        <div className="inspector-head">
          <div className="inspector-title">
            <span className="inspector-id">{node.label}</span>
            <span className="inspector-status">{statusOf(node)}</span>
          </div>
          <button className="inspector-close" onClick={onClose} aria-label="Close inspector">
            ×
          </button>
        </div>

        {edit ? (
          <section className="inspector-section">
            <div className="inspector-field">
              <label htmlFor="inspector-id-input">Component</label>
              <input
                id="inspector-id-input"
                key={`id-${node.label}`}
                className="inspector-input"
                defaultValue={node.label}
                onKeyDown={blurOnEnter}
                onBlur={(e) => {
                  const next = e.target.value.trim()
                  if (next !== node.label && commit((a) => renameComponent(a, node.label, next))) {
                    onSelect(next)
                    return
                  }
                  e.target.value = node.label
                }}
              />
            </div>

            <div className="inspector-field">
              <label htmlFor="inspector-purpose-input">Purpose</label>
              <input
                id="inspector-purpose-input"
                key={`purpose-${node.purpose}`}
                className="inspector-input"
                defaultValue={node.purpose}
                onKeyDown={blurOnEnter}
                onBlur={(e) => {
                  const next = e.target.value.trim()
                  if (next !== node.purpose && commit((a) => setPurpose(a, node.label, next))) return
                  e.target.value = node.purpose
                }}
              />
            </div>

            <div className="inspector-field">
              <label htmlFor="inspector-owns-input">Owns</label>
              <textarea
                id="inspector-owns-input"
                key={`owns-${owned}-${pass}`}
                className="inspector-textarea"
                rows={4}
                defaultValue={owned}
                onBlur={(e) => {
                  const value = e.target.value
                  if (value === owned) return
                  commit((a) => setOwns(a, node.label, value.split('\n')))
                  setPass((p) => p + 1)
                }}
              />
            </div>

            <button className="inspector-danger" onClick={() => onDrop?.(node.label)}>
              Delete component
            </button>
            <p className="inspector-hint">Or select it on the canvas and press Delete.</p>
          </section>
        ) : (
          <>
            {node.purpose && (
              <section className="inspector-section">
                <h3>{node.kind === 'file' ? 'Path' : 'Purpose'}</h3>
                <p className="inspector-purpose">{node.purpose}</p>
              </section>
            )}

            {node.owns.length > 0 && (
              <section className="inspector-section">
                <h3>Owns</h3>
                <ul className="inspector-owns">
                  {node.owns.map((glob) => (
                    <li key={glob}>{glob}</li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        {node.badges.length > 0 && (
          <section className="inspector-section">
            <h3>Proposed packages</h3>
            <div className="node-badges">
              {node.badges.map((b) => (
                <span key={b} className="badge">
                  {b}
                </span>
              ))}
            </div>
          </section>
        )}
      </aside>
    </>
  )
}
