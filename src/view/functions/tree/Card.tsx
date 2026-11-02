import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { FunctionRow } from '../../../../shared/types'
import Mark, { plural } from '../Mark'

export type CardData = {
  title: string
  note: string
  row: FunctionRow | null
  count: number
  open: boolean
  also: number
  dim: boolean
  focused: boolean
  onToggle: (id: string) => void
  onOpen: (row: FunctionRow) => void
}

export type CardNode = Node<CardData, 'card'>

const baseName = (file: string) => file.split('/').pop() ?? file

function Body({ data }: { data: CardData }) {
  const { row } = data
  if (!row) {
    return (
      <div className="fn-card-body">
        <span className="fn-card-title">{data.title}</span>
        <span className="fn-card-summary">{data.note}</span>
      </div>
    )
  }

  return (
    <button className="fn-card-body" onClick={() => data.onOpen(row)} title={`${row.file}:${row.line}`}>
      <span className="fn-card-head">
        <Mark importance={row.importance} />
        <span className="fn-card-name">{row.name}</span>
      </span>
      <span className="fn-card-summary">{row.summary}</span>
      {data.also > 0 && <span className="fn-card-also">also used by {plural(data.also, 'other')}</span>}
      <span className="fn-card-foot">
        <span className="fn-card-file">{baseName(row.file)}</span>
        <span className="fn-card-lines">{plural(row.lines, 'line')}</span>
      </span>
    </button>
  )
}

export default memo(function Card({ id, data }: NodeProps<CardNode>) {
  const classes = ['fn-card', data.row ? '' : 'fn-card-group', data.dim ? 'dim' : '', data.focused ? 'focused' : '']

  return (
    <div className={classes.filter(Boolean).join(' ')}>
      <Handle type="target" position={Position.Top} isConnectable={false} className="fn-card-handle" />
      <Body data={data} />
      {data.count > 0 && (
        <button
          className="fn-card-toggle"
          aria-expanded={data.open}
          aria-label={`${data.open ? 'Collapse' : 'Expand'} ${plural(data.count, 'child')}`}
          onClick={() => data.onToggle(id)}
        >
          {data.count.toLocaleString()} {data.open ? '⌃' : '⌄'}
        </button>
      )}
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="fn-card-handle" />
    </div>
  )
})
