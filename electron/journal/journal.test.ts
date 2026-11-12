import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createJournal } from '.'

const rowSchema = z.object({ n: z.number() })

let dir: string
const fileOf = (root: string) => path.join(dir, 'rows', `${path.basename(root)}.json`)

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-journal-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('createJournal', () => {
  it('starts empty when nothing was written', () => {
    expect(createJournal(fileOf, rowSchema, 3).list('/a')).toEqual([])
  })

  it('writes newest first and reloads the same rows in a fresh journal', () => {
    const journal = createJournal(fileOf, rowSchema, 3)
    journal.append('/a', { n: 1 })
    journal.append('/a', { n: 2 })

    expect(journal.list('/a')).toEqual([{ n: 2 }, { n: 1 }])
    expect(createJournal(fileOf, rowSchema, 3).list('/a')).toEqual([{ n: 2 }, { n: 1 }])
  })

  it('keeps each root apart', () => {
    const journal = createJournal(fileOf, rowSchema, 3)
    journal.append('/a', { n: 1 })
    journal.append('/b', { n: 2 })

    expect(journal.list('/a')).toEqual([{ n: 1 }])
    expect(createJournal(fileOf, rowSchema, 3).list('/b')).toEqual([{ n: 2 }])
  })

  it('drops the oldest rows past the cap, in memory and on disk', () => {
    const journal = createJournal(fileOf, rowSchema, 3)
    for (const n of [1, 2, 3, 4, 5]) journal.append('/a', { n })

    expect(journal.list('/a')).toEqual([{ n: 5 }, { n: 4 }, { n: 3 }])
    expect(JSON.parse(fs.readFileSync(fileOf('/a'), 'utf8'))).toEqual([{ n: 5 }, { n: 4 }, { n: 3 }])
  })

  it('caps a stored file that is longer than the limit', () => {
    fs.mkdirSync(path.dirname(fileOf('/a')), { recursive: true })
    fs.writeFileSync(fileOf('/a'), JSON.stringify([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]))

    expect(createJournal(fileOf, rowSchema, 2).list('/a')).toEqual([{ n: 1 }, { n: 2 }])
  })

  it('drops rows that fail the schema and keeps the rest', () => {
    fs.mkdirSync(path.dirname(fileOf('/a')), { recursive: true })
    fs.writeFileSync(fileOf('/a'), JSON.stringify([{ n: 1 }, { n: 'two' }, null, 7, { n: 3 }]))

    expect(createJournal(fileOf, rowSchema, 5).list('/a')).toEqual([{ n: 1 }, { n: 3 }])
  })

  it.each([['not json'], ['{"n":1}'], ['']])('treats an unreadable store %j as empty', (raw) => {
    fs.mkdirSync(path.dirname(fileOf('/a')), { recursive: true })
    fs.writeFileSync(fileOf('/a'), raw)

    expect(createJournal(fileOf, rowSchema, 5).list('/a')).toEqual([])
  })

  it('replaces one row with several in place and persists the result', () => {
    const journal = createJournal(fileOf, rowSchema, 4)
    for (const n of [1, 2, 3]) journal.append('/a', { n })
    const middle = journal.list('/a')[1]!

    expect(journal.replace('/a', middle, [{ n: 20 }, { n: 21 }])).toEqual([{ n: 3 }, { n: 20 }, { n: 21 }, { n: 1 }])
    expect(createJournal(fileOf, rowSchema, 4).list('/a')).toEqual([{ n: 3 }, { n: 20 }, { n: 21 }, { n: 1 }])
  })

  it('caps after a replace and leaves the list alone when the row is gone', () => {
    const journal = createJournal(fileOf, rowSchema, 3)
    for (const n of [1, 2, 3]) journal.append('/a', { n })
    const newest = journal.list('/a')[0]!

    expect(journal.replace('/a', newest, [{ n: 30 }, { n: 31 }])).toEqual([{ n: 30 }, { n: 31 }, { n: 2 }])
    expect(journal.replace('/a', { n: 99 }, [{ n: 0 }])).toEqual([{ n: 30 }, { n: 31 }, { n: 2 }])
  })

  it('keeps the row in memory and leaves no temporary file when the disk write fails', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    fs.writeFileSync(path.join(dir, 'rows'), 'a file where the folder should be')
    const journal = createJournal(fileOf, rowSchema, 3)

    expect(journal.append('/a', { n: 1 })).toEqual([{ n: 1 }])
    expect(journal.list('/a')).toEqual([{ n: 1 }])
    expect(error).toHaveBeenCalledOnce()
    expect(fs.readdirSync(dir)).toEqual(['rows'])
  })
})
