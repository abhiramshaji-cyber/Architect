import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { FunctionFacts, FunctionRank } from '../../shared/types'

const CACHE_VERSION = 1

export type FileRanks = { hash: string; keys: string[]; ranks: FunctionRank[] }

export type RankCache = Record<string, FileRanks>

export function hashOf(source: string): string {
  return createHash('sha256').update(`${CACHE_VERSION}\0${source}`).digest('hex')
}

export function keysOf(facts: FunctionFacts[]): string[] {
  return facts.map((f) => `${f.name}:${f.line}`)
}

export function hit(cache: RankCache, file: string, hash: string, keys: string[]): FunctionRank[] | null {
  const entry = cache[file]
  if (entry === undefined || entry.hash !== hash || entry.keys.length !== keys.length) return null
  return entry.keys.every((key, at) => key === keys[at]) ? entry.ranks : null
}

function isRank(value: unknown): value is FunctionRank {
  if (typeof value !== 'object' || value === null) return false
  const { importance, summary } = value as Partial<FunctionRank>
  return typeof summary === 'string' && summary !== '' && [1, 2, 3, 4, 5].includes(importance as number)
}

function isFileRanks(value: unknown): value is FileRanks {
  if (typeof value !== 'object' || value === null) return false
  const { hash, keys, ranks } = value as Partial<FileRanks>
  if (typeof hash !== 'string' || !Array.isArray(keys) || !Array.isArray(ranks)) return false
  return keys.length === ranks.length && keys.every((k) => typeof k === 'string') && ranks.every(isRank)
}

export function readCache(file: string): RankCache {
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, FileRanks] => isFileRanks(entry[1])),
  )
}

export function writeCache(file: string, cache: RankCache): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify(cache))
  fs.renameSync(temp, file)
}
