import type { FunctionRow } from '../../../shared/types'
import { resolve } from '../focus/history'
import { startOf, type Start } from '../flow/Picker'

export function startFrom(rows: FunctionRow[], key: string | null): Start | null {
  const row = key === null ? undefined : rows[resolve(rows, key)]
  return row?.entry ? startOf(rows, row) : null
}
