import fs from 'node:fs'

const POLL_MS = 30

const STAMP_GRANULARITY_MS = 2000

type Snapshot = { stamp: string; mtimeMs: number; text: string }

function stampOf(file: string): { stamp: string; mtimeMs: number } {
  try {
    const stats = fs.statSync(file)
    return { stamp: `${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`, mtimeMs: stats.mtimeMs }
  } catch (err) {
    return { stamp: (err as NodeJS.ErrnoException).code ?? String(err), mtimeMs: Number.NaN }
  }
}

function snapshot(file: string): Snapshot {
  const { stamp, mtimeMs } = stampOf(file)
  try {
    return { stamp, mtimeMs, text: fs.readFileSync(file, 'utf8') }
  } catch (err) {
    return { stamp, mtimeMs, text: (err as NodeJS.ErrnoException).code ?? String(err) }
  }
}

function same(a: Snapshot, b: Snapshot): boolean {
  return a.stamp === b.stamp && a.text === b.text
}

export function watchContract(file: string, changed: () => void): { close(): void } {
  let settled = snapshot(file)
  let last = settled

  const poll = setInterval(() => {
    const { stamp, mtimeMs } = stampOf(file)
    const recent = Date.now() - mtimeMs <= STAMP_GRANULARITY_MS
    if (stamp === last.stamp && !recent && same(last, settled)) return

    const now = snapshot(file)
    const stable = same(now, last)
    last = now
    if (!stable || same(now, settled)) return

    settled = now
    changed()
  }, POLL_MS)

  return { close: () => clearInterval(poll) }
}
