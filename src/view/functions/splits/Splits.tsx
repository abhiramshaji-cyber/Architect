import type { FileSplit, FunctionSplit, SplitSuggestion } from '../../../../shared/types'
import { plural } from '../Mark'

type SplitsProps = { splits: SplitSuggestion[]; scope: string; onGo: (file: string, line: number) => void }

type Go = SplitsProps['onGo']

function overText(split: FileSplit): string {
  const parts = [split.over.lines && plural(split.over.lines.count, 'line'), split.over.jobs && plural(split.over.jobs.count, 'job group')]
  return parts.filter(Boolean).join(', ')
}

function Place({ file, line, onGo }: { file: string; line: number; onGo: Go }) {
  return (
    <button className="fn-count-link" title={`Open ${file}:${line}`} onClick={() => onGo(file, line)}>
      {file}:{line}
    </button>
  )
}

function FileItem({ split, onGo }: { split: FileSplit; onGo: Go }) {
  return (
    <li>
      <Place file={split.path} line={1} onGo={onGo} /> <span className="fn-split-facts">{overText(split)}</span>
      {split.blocked ? (
        <p className="fn-split-note">No split: {split.blocked}</p>
      ) : (
        <ul>
          {split.groups.map((group) => (
            <li key={`${group.members[0]?.name}:${group.members[0]?.line}`}>
              <span className={group.file ? 'fn-split-file' : 'fn-split-unnamed'}>{group.file ?? `Unnamed: ${group.unnamed}`}</span>{' '}
              <span className="fn-split-facts">
                {plural(group.lines, 'line')}, {group.members.map((member) => `${member.name}:${member.line}`).join(', ')}
              </span>
            </li>
          ))}
          <li className="fn-split-facts">
            {split.files.limit === 'off' ? plural(split.files.count, 'code file') : `${split.files.count} of ${plural(split.files.limit, 'code file')}`} in {split.folder}/,{' '}
            {plural(split.stays.lines, 'line')} stay in the entry
          </li>
        </ul>
      )}
    </li>
  )
}

function FunctionItem({ split, onGo }: { split: FunctionSplit; onGo: Go }) {
  return (
    <li>
      <Place file={split.path} line={split.line} onGo={onGo} />{' '}
      <span className="fn-split-facts">
        {split.name}, {plural(split.lines, 'line')}, {plural(split.callers, 'caller')}
      </span>
      {split.blocked ? (
        <p className="fn-split-note">Flagged only: {split.blocked}</p>
      ) : (
        <ul>
          {split.points.map((point) => (
            <li key={`${point.line}-${point.endLine}-${point.label}`}>
              <button className="fn-count-link" onClick={() => onGo(split.path, point.line)}>
                Extract {point.label}
              </button>{' '}
              <span className="fn-split-facts">
                {point.line}-{point.endLine}, {plural(point.lines, 'line')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export default function Splits({ splits: all, scope, onGo }: SplitsProps) {
  const splits = scope === '' ? all : all.filter((split) => split.path.startsWith(`${scope}/`))
  if (splits.length === 0) return null
  return (
    <details className="fn-splits">
      <summary>{plural(splits.length, 'split suggestion')}</summary>
      <ul>
        {splits.map((split) =>
          split.kind === 'file' ? (
            <FileItem key={`file:${split.path}`} split={split} onGo={onGo} />
          ) : (
            <FunctionItem key={`fn:${split.path}:${split.line}`} split={split} onGo={onGo} />
          ),
        )}
      </ul>
    </details>
  )
}
