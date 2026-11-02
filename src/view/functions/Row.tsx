import { memo } from 'react'
import type { FunctionRow } from '../../../shared/types'
import { baseName } from '../../model/codemap'
import Mark, { plural } from './Mark'
import { folderOf } from './scope/pick'

type RowProps = { row: FunctionRow; onOpen: (row: FunctionRow) => void; onScope: (scope: string) => void }

export default memo(function Row({ row, onOpen, onScope }: RowProps) {
  const folder = folderOf(row.file)
  return (
    <li>
      <div
        className="fn-row"
        role="button"
        tabIndex={0}
        onClick={() => onOpen(row)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
          event.preventDefault()
          onOpen(row)
        }}
        title={`${row.file}:${row.line}`}
      >
        <Mark importance={row.importance} />
        <span className="fn-main">
          <span className="fn-head">
            <span className="fn-name">{row.name}</span>
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
                {baseName(row.file)}
              </bdi>
            </span>
          </span>
          <span className="fn-summary">{row.summary}</span>
        </span>
        <span className="fn-lines" aria-label={plural(row.lines, 'line')}>
          {row.lines.toLocaleString()}
        </span>
      </div>
    </li>
  )
})
