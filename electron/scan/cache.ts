import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { CodeMap } from '../../shared/types'
import type { DescriptionCache } from './describe'

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const MAP_VERSION = 6

const LEGACY_MAP = path.join('.architect', 'map.json')

function canonicalRoot(root: string): string {
  const resolved = path.resolve(root)
  try {
    return fs.realpathSync.native(resolved)
  } catch {
    return resolved
  }
}

export function cacheKey(root: string): string {
  return createHash('sha256').update(canonicalRoot(root)).digest('hex')
}

function mapPath(dir: string, root: string) {
  return path.join(dir, 'maps', `${cacheKey(root)}.json`)
}

function isCallRef(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const ref = value as Record<string, unknown>
  return typeof ref.file === 'string' && Number.isInteger(ref.fn)
}

function isFunctionEntry(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const fn = value as Record<string, unknown>
  if (!Array.isArray(fn.calls) || !fn.calls.every(isCallRef)) return false
  if (typeof fn.endLine !== 'number') return false
  if (fn.doc !== undefined && typeof fn.doc !== 'string') return false
  if (fn.kind !== undefined && typeof fn.kind !== 'string') return false
  return typeof fn.name === 'string' && typeof fn.line === 'number' && typeof fn.description === 'string'
}

function isFileStart(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const start = value as Record<string, unknown>
  return typeof start.kind === 'string' && Array.isArray(start.calls) && start.calls.every(isCallRef)
}

function isFileEntry(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const file = value as Record<string, unknown>
  if (file.starts !== undefined && !(Array.isArray(file.starts) && file.starts.every(isFileStart))) return false
  return typeof file.path === 'string' && Array.isArray(file.functions) && file.functions.every(isFunctionEntry)
}

function isFolderEntry(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const folder = value as Record<string, unknown>
  if (typeof folder.path !== 'string') return false
  if (!Array.isArray(folder.folders) || !folder.folders.every((f) => typeof f === 'string')) return false
  return Array.isArray(folder.files) && folder.files.every(isFileEntry)
}

function isCodeMap(value: unknown): value is CodeMap {
  if (typeof value !== 'object' || value === null) return false
  const map = value as Partial<CodeMap>
  if (typeof map.root !== 'string' || typeof map.scannedAt !== 'number') return false
  return Array.isArray(map.folders) && map.folders.every(isFolderEntry)
}

export type StoredMap = { map: CodeMap | null; cache: DescriptionCache }

function decodeStoredMap(raw: string, key: string | null): StoredMap | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const { version, root, map, cache } = parsed as {
    version?: unknown
    root?: unknown
    map?: unknown
    cache?: unknown
  }
  if (key !== null && root !== key) return null

  const entries =
    typeof cache === 'object' && cache !== null && !Array.isArray(cache)
      ? Object.entries(cache).filter((e): e is [string, string] => typeof e[1] === 'string')
      : []

  const current = version === MAP_VERSION && isCodeMap(map) ? map : null

  return { map: current, cache: Object.fromEntries(entries) }
}

function discardLegacyMap(root: string) {
  const legacy = path.join(root, LEGACY_MAP)
  const dir = path.join(root, '.architect')
  try {
    if (!fs.existsSync(legacy)) return
    if (spawnSync('git', ['-C', root, 'ls-files', '--error-unmatch', '--', LEGACY_MAP], { stdio: 'ignore' }).status === 0) return
    fs.rmSync(legacy, { force: true })
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
  } catch (err) {
    console.error('could not remove the code map from the project:', errorText(err))
  }
}

function migrateLegacyMap(dir: string, root: string): StoredMap | null {
  const legacy = path.join(root, LEGACY_MAP)

  let raw: string
  try {
    raw = fs.readFileSync(legacy, 'utf8')
  } catch {
    return null
  }

  const stored = decodeStoredMap(raw, null)
  if (!stored) return null

  try {
    writeStoredMap(dir, root, stored)
  } catch (err) {
    console.error('could not move the code map out of the project:', errorText(err))
    return stored
  }

  discardLegacyMap(root)

  return stored
}

function readCachedMap(dir: string, root: string): StoredMap | null {
  let raw: string
  try {
    raw = fs.readFileSync(mapPath(dir, root), 'utf8')
  } catch {
    return null
  }

  return decodeStoredMap(raw, cacheKey(root))
}

export function readStoredMap(dir: string, root: string): StoredMap | null {
  if (!fs.statSync(path.resolve(root), { throwIfNoEntry: false })?.isDirectory()) return null

  const cached = readCachedMap(dir, root)
  if (!cached) return migrateLegacyMap(dir, root)

  discardLegacyMap(root)

  return cached
}

export function writeStoredMap(dir: string, root: string, stored: StoredMap) {
  const file = mapPath(dir, root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ version: MAP_VERSION, root: cacheKey(root), ...stored }, null, 2))
}
