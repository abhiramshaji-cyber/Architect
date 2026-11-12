import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { FunctionRow } from '../../../shared/types'
import { baseName } from '../../model/codemap'
import Facts from '../functions/facts/Facts'
import type { Way } from '../functions/facts/calls'
import { signatureText } from '../functions/facts/signature'
import Mark, { plural } from '../functions/Mark'
import type { Item } from './graph'

export type FocusData = {
  item: Item
  row: FunctionRow | null
  scope: string
  onGo: (at: number) => void
  onOpen: (row: FunctionRow) => void
  onMore: (way: Way) => void
  onWiden: () => void
  onRelated: (at: number, way: Way) => void
}

export type FocusNode = Node<FocusData, 'focus'>

const WORD: Record<Way, string> = { callers: 'caller', callees: 'callee' }

function Loops({ row, mutual, full }: { row: FunctionRow; mutual: boolean; full: boolean }) {
  const loops = [
    row.recursive && { mark: '↻', word: 'calls itself', title: `${row.name} calls itself` },
    mutual && { mark: '⇄', word: 'calls back', title: `${row.name} also calls the focused function` },
  ].filter((loop) => loop !== false && loop !== undefined)
  return loops.map(({ mark, word, title }) => (
    <span key={mark} className="fn-badge focus-loop" title={title} aria-label={title}>
      {full ? `${mark} ${word}` : mark}
    </span>
  ))
}

function Head({ row, mutual, full }: { row: FunctionRow; mutual: boolean; full: boolean }) {
  const signature = signatureText(row.signature)
  return (
    <>
      <span className="fn-card-head">
        <Mark importance={row.importance} />
        <span className="fn-card-name" title={row.name + signature}>
          {row.name}
        </span>
        {row.exported && full && <span className="fn-badge">exported</span>}
        <Loops row={row} mutual={mutual} full={full} />
      </span>
      {signature !== '' && (
        <span className="fn-card-sig" title={signature}>
          {signature}
        </span>
      )}
    </>
  )
}

function Body({ data }: { data: FocusData }) {
  const { item, row } = data
  if (item.kind === 'more')
    return (
      <button className="focus-extra" onClick={() => data.onMore(item.way)}>
        +{item.count.toLocaleString()} more {item.count === 1 ? WORD[item.way] : item.way}
      </button>
    )
  if (item.kind === 'outside')
    return (
      <button className="focus-extra" onClick={data.onWiden} title="Show the whole project">
        {plural(item.count, WORD[item.way])} outside {data.scope}
      </button>
    )
  if (!row || item.kind !== 'fn') return null

  if (item.way === null)
    return (
      <div className="fn-card-body">
        <button className="fn-card-open" onClick={() => data.onOpen(row)} title={`Open ${row.file}:${row.line}`}>
          <Head row={row} mutual={false} full />
          {row.doc !== undefined && (
            <span className="fn-card-doc" title={row.doc}>
              {row.doc}
            </span>
          )}
          <span className="fn-card-foot">
            <span className="fn-card-file">
              {baseName(row.file)}:{row.line}
            </span>
            <span className="fn-card-lines">{plural(row.lines, 'line')}</span>
          </span>
        </button>
        <Facts row={row} at={item.at} onRelated={data.onRelated} />
      </div>
    )

  return (
    <div className="fn-card-body">
      <button className="fn-card-open" onClick={() => data.onGo(item.at)} title={`Focus ${row.name}`}>
        <Head row={row} mutual={item.mutual} full={false} />
      </button>
      <button className="focus-file" onClick={() => data.onOpen(row)} title={`Open ${row.file}:${row.line}`}>
        {row.file}:{row.line}
      </button>
    </div>
  )
}

export default memo(function FocusCard({ data }: NodeProps<FocusNode>) {
  const { item } = data
  const classes = [
    'fn-card',
    'focus-card',
    item.kind === 'fn' ? '' : `focus-${item.kind}`,
    item.kind === 'fn' && item.way === null ? 'focused focus-center' : '',
  ]
  return (
    <div className={classes.filter(Boolean).join(' ')}>
      <Handle type="target" position={Position.Left} isConnectable={false} className="fn-card-handle" />
      <Body data={data} />
      <Handle type="source" position={Position.Right} isConnectable={false} className="fn-card-handle" />
    </div>
  )
})
