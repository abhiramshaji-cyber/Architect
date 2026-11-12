import { memo } from 'react'
import { Handle, Position, useStore, type Node, type NodeHandle, type NodeProps, type ReactFlowState } from '@xyflow/react'
import type { FunctionRow } from '../../../../../shared/types'
import Facts from '../../facts/Facts'
import type { Way } from '../../facts/calls'
import { signatureText } from '../../facts/signature'
import Mark, { plural } from '../../Mark'
import { CARD_H, TRUNK } from '../layout'
import Pill from './Pill'

export type CardData = {
  title: string
  notes: string[]
  tag?: string
  pill: string
  row: FunctionRow | null
  at: number
  count: number
  open: boolean
  also: number
  elsewhere: number
  dim: boolean
  focused: boolean
  onToggle: (id: string) => void
  onJump: (at: number) => void
  onOpen: (row: FunctionRow) => void
  onRelated: (at: number, way: Way) => void
  onFocus: (at: number) => void
}

export type CardNode = Node<CardData, 'card'>

export const PILL_ZOOM = 0.5

const HANDLE = 6

export const HANDLES: NodeHandle[] = [
  { type: 'target', position: Position.Left, x: -HANDLE / 2, y: CARD_H / 2 - HANDLE / 2, width: HANDLE, height: HANDLE },
  { type: 'source', position: Position.Bottom, x: TRUNK - HANDLE / 2, y: CARD_H - HANDLE / 2, width: HANDLE, height: HANDLE },
]

export const farOf = (state: ReactFlowState) => state.transform[2] < PILL_ZOOM

const leafOf = (file: string) => file.split('/').pop() ?? file

function Body({ data }: { data: CardData }) {
  const { row } = data
  if (!row) {
    return (
      <div className="fn-card-body">
        <span className="fn-card-head">
          <span className="fn-card-title" title={data.title}>
            {data.title}
          </span>
          {data.tag && <span className="fn-badge">{data.tag}</span>}
        </span>
        {data.notes.map((note) => (
          <span key={note} className="fn-card-note">
            {note}
          </span>
        ))}
      </div>
    )
  }

  const signature = signatureText(row.signature)

  return (
    <div className="fn-card-body">
      <button className="fn-card-open" onClick={() => data.onOpen(row)} title={`${row.file}:${row.line}`}>
        <span className="fn-card-head">
          <Mark importance={row.importance} />
          <span className="fn-card-name" title={row.name + signature}>
            {row.name}
          </span>
          {row.exported && <span className="fn-badge">exported</span>}
        </span>
        {signature !== '' && (
          <span className="fn-card-sig" title={signature}>
            {signature}
          </span>
        )}
        {row.doc !== undefined && (
          <span className="fn-card-doc" title={row.doc}>
            {row.doc}
          </span>
        )}
        {data.also > 0 && <span className="fn-card-also">also used by {plural(data.also, 'other')}</span>}
        <span className="fn-card-foot">
          <span className="fn-card-file">
            {leafOf(row.file)}:{row.line}
          </span>
          <span className="fn-card-lines">{plural(row.lines, 'line')}</span>
        </span>
      </button>
      {data.elsewhere > 0 && (
        <button className="fn-card-jump" onClick={() => data.onJump(data.at)}>
          calls {plural(data.elsewhere, 'function')} drawn elsewhere
        </button>
      )}
      <Facts row={row} at={data.at} onRelated={data.onRelated} onFocus={data.onFocus} />
    </div>
  )
}

export default memo(function Card({ id, data }: NodeProps<CardNode>) {
  const far = useStore(farOf)
  const classes = [
    'fn-card',
    data.row ? '' : 'fn-card-group',
    far ? 'fn-card-far' : '',
    data.dim ? 'dim' : '',
    data.focused ? 'focused' : '',
  ]

  return (
    <div className={classes.filter(Boolean).join(' ')}>
      <Handle type="target" position={Position.Left} isConnectable={false} className="fn-card-handle" />
      {far ? <Pill id={id} data={data} /> : <Body data={data} />}
      {!far && data.count > 0 && (
        <button
          className="fn-card-toggle"
          aria-expanded={data.open}
          aria-label={`${data.open ? 'Collapse' : 'Expand'} ${plural(data.count, 'child')}`}
          onClick={() => data.onToggle(id)}
        >
          {data.count.toLocaleString()} {data.open ? '⌃' : '⌄'}
        </button>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className="fn-card-handle"
        style={{ left: TRUNK }}
      />
    </div>
  )
})
