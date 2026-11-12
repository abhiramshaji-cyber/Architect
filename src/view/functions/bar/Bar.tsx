import type { ScopeFolder } from '../../../../shared/types'
import Legend from '../../recency/Legend'
import { plural } from '../Mark'
import type { SortKey } from '../order'
import ScopePicker from '../scope/ScopePicker'
import { MODES, type Mode } from './mode'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'importance', label: 'Importance' },
  { key: 'lines', label: 'Lines' },
  { key: 'name', label: 'Name' },
  { key: 'recent', label: 'Recent' },
]

type BarProps = {
  count: number | null
  project: string
  scope: string
  folders: ScopeFolder[]
  mode: Mode
  sort: SortKey
  legend: boolean
  query: string
  onScope: (scope: string) => void
  onMode: (mode: Mode) => void
  onSort: (sort: SortKey) => void
  onQuery: (query: string) => void
}

export function Choice<K extends string>({ label, keys, value, onPick }: { label: string; keys: { key: K; label: string }[]; value: K; onPick: (key: K) => void }) {
  return (
    <div className="fn-sort" role="group" aria-label={label}>
      {keys.map(({ key, label: text }) => (
        <button key={key} className={key === value ? 'mode active' : 'mode'} aria-pressed={key === value} onClick={() => onPick(key)}>
          {text}
        </button>
      ))}
    </div>
  )
}

export default function Bar(props: BarProps) {
  const { count, scope, mode } = props
  return (
    <div className="fn-bar">
      <p className="fn-count" aria-live="polite">
        {count === null
          ? 'Reading functions…'
          : scope === ''
            ? plural(count, 'function')
            : `${plural(count, 'function')} in ${scope}`}
      </p>
      <ScopePicker project={props.project} scope={scope} folders={props.folders} onScope={props.onScope} />
      <Choice label="View" keys={MODES} value={mode} onPick={props.onMode} />
      {mode === 'list' && <Choice label="Sort by" keys={SORTS} value={props.sort} onPick={props.onSort} />}
      {mode === 'list' && props.legend && <Legend />}
      {mode !== 'focus' && (
        <input
          className="search-input fn-search"
          type="search"
          placeholder="Filter by name, file or doc"
          aria-label="Filter functions"
          value={props.query}
          onChange={(e) => props.onQuery(e.target.value)}
        />
      )}
    </div>
  )
}
