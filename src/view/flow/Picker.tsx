import type { FunctionList, FunctionRow } from '../../../shared/types'
import { REASON } from '../functions/tree/outline'

export type Start = { file: string; name: string; nth: number }

const namesakes = (rows: FunctionRow[], file: string, name: string) =>
  rows.filter((row) => row.file === file && row.name === name).sort((a, b) => a.line - b.line)

export function startOf(rows: FunctionRow[], row: FunctionRow): Start {
  return { file: row.file, name: row.name, nth: namesakes(rows, row.file, row.name).indexOf(row) }
}

export function refound(rows: FunctionRow[], held: Start): FunctionRow | null {
  const row = namesakes(rows, held.file, held.name)[held.nth]
  return row?.entry ? row : null
}

type PickerProps = { list: FunctionList; picked: Start | null; onPick: (start: Start | null) => void }

export default function Picker({ list, picked, onPick }: PickerProps) {
  const groups = list.tree.groups.filter((group) => group.members.length > 0)
  const start = picked && refound(list.rows, picked)
  const at = start ? list.rows.indexOf(start) : -1
  const choose = (value: string) => {
    const row = value === '' ? undefined : list.rows[Number(value)]
    onPick(row ? startOf(list.rows, row) : null)
  }

  return (
    <label className="flow-picker">
      <span>Starting point</span>
      <select value={at === -1 ? '' : at} onChange={(e) => choose(e.target.value)}>
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
