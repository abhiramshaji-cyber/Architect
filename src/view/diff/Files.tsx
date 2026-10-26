import type { ChangedFile, ChangeStatus, DiffSection } from '../../../shared/types'

export type Selected = { section: DiffSection; file: ChangedFile }

export type Staging = 'staged' | 'partial' | null

const MARK: Record<ChangeStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechanged: 'T',
  unmerged: 'U',
  untracked: 'A',
}

const WORD: Record<ChangeStatus, string> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  typechanged: 'Type changed',
  unmerged: 'Conflicted',
  untracked: 'New, not tracked yet',
}

export function splitPath(path: string, prefix: string): { name: string; dir: string } {
  const local = prefix !== '' && path.startsWith(prefix) ? path.slice(prefix.length) : path
  const cut = local.lastIndexOf('/')
  return cut === -1 ? { name: local, dir: '' } : { name: local.slice(cut + 1), dir: local.slice(0, cut) }
}

export function counts(file: ChangedFile): string {
  if (file.binary) return 'binary'
  return [file.added ? `+${file.added}` : '', file.removed ? `-${file.removed}` : ''].filter(Boolean).join(' ')
}

function tooltip(file: ChangedFile): string {
  const moved = file.from !== null && file.from !== file.path ? ` from ${file.from}` : ''
  return `${WORD[file.status]}${moved}: ${file.path}`
}

export function Files({
  section,
  files,
  prefix,
  selected,
  staging,
  tags = false,
  onSelect,
  onStage,
}: {
  section: DiffSection
  files: ChangedFile[]
  prefix: string
  selected: Selected | null
  staging?: (file: ChangedFile) => Staging
  tags?: boolean
  onSelect: (selected: Selected) => void
  onStage?: (file: ChangedFile, staged: boolean) => void
}) {
  return (
    <ul className="diff-files">
      {files.map((file) => {
        const { name, dir } = splitPath(file.path, prefix)
        const current = selected?.section === section && selected.file.path === file.path
        const staged = staging?.(file) ?? null

        return (
          <li key={`${file.status}:${file.from ?? ''}:${file.path}`}>
            <button
              className={current ? 'diff-file current' : 'diff-file'}
              title={tooltip(file)}
              onClick={() => onSelect({ section, file })}
            >
              <span className={`diff-mark ${file.status}`}>{MARK[file.status]}</span>
              <span className="diff-file-path">
                <span className="diff-file-name">{name}</span>
                {dir && <span className="diff-file-dir">{dir}</span>}
              </span>
              {tags && staged && <span className="diff-file-tag">{staged}</span>}
              <span className="diff-file-counts">{counts(file)}</span>
            </button>
            {onStage && (
              <button className="ghost diff-stage" onClick={() => onStage(file, staged === 'staged')}>
                {staged === 'staged' ? 'Unstage' : 'Stage'}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
