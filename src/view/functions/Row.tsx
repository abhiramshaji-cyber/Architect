import { memo } from 'react'
import type { Change, FunctionRow } from '../../../shared/types'
import { baseName } from '../../model/codemap'
import { describeChange } from '../../model/recency'
import Facts from './facts/Facts'
import type { Way } from './facts/calls'
import { signatureText } from './facts/signature'
import Mark, { plural } from './Mark'
import { folderOf } from './scope/pick'

type RowProps = {
  row: FunctionRow
  at: number
  change?: Change
  step?: number
  onOpen: (row: FunctionRow) => void
  onScope: (scope: string) => void
  onRelated: (at: number, way: Way) => void
  onFocus: (at: number) => void
}

export default memo(function Row({ row, at, change, step, onOpen, onScope, onRelated, onFocus }: RowProps) {
  const folder = folderOf(row.file)
  const hint = describeChange(change, Date.now())
  return (
    <li>
      <div
        className={step === undefined ? 'fn-row' : `fn-row age-${step}`}
        role="button"
        tabIndex={0}
        onClick={() => onOpen(row)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
          event.preventDefault()
          onOpen(row)
        }}
        title={hint ? `${row.file}:${row.line}\n${hint}` : `${row.file}:${row.line}`}
      >
        <Mark importance={row.importance} />
        <span className="fn-main">
          <span className="fn-head">
            <span className="fn-name" title={row.name + signatureText(row.signature)}>
              {row.name}
              <span className="fn-sig">{signatureText(row.signature)}</span>
            </span>
            <span className="fn-file">
              <bdi>
                {folder !== '' && (
                  <button
                    className="fn-folder"
                    title={`Show only ${folder}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onScope(folder)
                    }}
                  >
                    {folder}/
                  </button>
                )}
                {baseName(row.file)}:{row.line}
              </bdi>
            </span>
          </span>
          {row.doc !== undefined && (
            <span className="fn-doc" title={row.doc}>
              {row.doc}
            </span>
          )}
          <span className="fn-foot">
            <Facts row={row} at={at} onRelated={onRelated} onFocus={onFocus} />
            {row.exported && <span className="cyber-badge cyber-badge--sm cyber-badge--chrome">exported</span>}
          </span>
        </span>
        <span className="fn-lines" aria-label={plural(row.lines, 'line')}>
          {row.lines.toLocaleString()}
        </span>
      </div>
    </li>
  )
})
