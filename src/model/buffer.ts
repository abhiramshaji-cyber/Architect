import type { SourceError, WriteError } from '../../shared/types'

const REFUSALS: Record<SourceError | WriteError, string> = {
  closed: 'This project is not open',
  range: 'That line range is not valid',
  outside: 'That file is outside the project',
  unreadable: 'This file could not be read',
  binary: 'This file is not readable text',
  large: 'This file is too large to open here',
  stale: 'This file changed on disk since you opened it. Reload to see it, then reapply your change.',
  denied: 'This file is read only',
}

export function refusalOf(error: SourceError | WriteError): string {
  return REFUSALS[error]
}

export type Buffer = {
  path: string
  disk: string
  hash: string
  draft: string
  error: SourceError | null
}

export function isDirty(buffer: Buffer | null): boolean {
  return buffer !== null && buffer.error === null && buffer.draft !== buffer.disk
}
