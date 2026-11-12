import type { FunctionList } from '../../../shared/types'
import { REASON } from '../functions/tree/outline'

type PickerProps = { list: FunctionList; picked: number | null; onPick: (at: number | null) => void }

export default function Picker({ list, picked, onPick }: PickerProps) {
  const groups = list.tree.groups.filter((group) => group.members.length > 0)

  return (
    <label className="flow-picker">
      <span>Starting point</span>
      <select value={picked ?? ''} onChange={(e) => onPick(e.target.value === '' ? null : Number(e.target.value))}>
        <option value="">{groups.length === 0 ? 'No starting points found by the scan' : 'Pick a starting point'}</option>
        {groups.map((group) => (
          <optgroup key={`${group.reason}\0${group.file}`} label={`${REASON[group.reason]} · ${group.file}`}>
            {group.members.map((at) => {
              const row = list.rows[at]
              return row?.entry ? (
                <option key={at} value={at}>
                  {`${row.name}  ${row.file}:${row.line}`}
                </option>
              ) : null
            })}
          </optgroup>
        ))}
      </select>
    </label>
  )
}
