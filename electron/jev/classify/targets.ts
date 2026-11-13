import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { CodeMap, Signature } from '../../../shared/types'
import { edgesOf } from '../../functions/facts'
import { isTestFile } from '../../scan/starts'

// Jev reads 64k tokens per request, so a body past this many characters is cut before it is sent
export const LONGEST_SOURCE = 120_000

export type Target = {
  at: number
  key: string
  state: string
  name: string
  file: string
  line: number
  signature: string
  inputs: string[]
  output: string
  callers: string[]
  callees: string[]
  source: string
  test: boolean
}

function signatureOf(signature: Signature | undefined): string {
  if (!signature) return ''
  const params = signature.params.map((param) => `${param.rest ? '...' : ''}${param.name}${param.optional ? '?' : ''}${param.type ? `: ${param.type}` : ''}`)
  return `(${params.join(', ')})${signature.returns ? `: ${signature.returns}` : ''}`
}

function linesOf(root: string, file: string, cache: Map<string, string[] | null>): string[] | null {
  if (!cache.has(file)) {
    try {
      cache.set(file, fs.readFileSync(path.join(root, file), 'utf8').split('\n'))
    } catch {
      cache.set(file, null)
    }
  }
  return cache.get(file) ?? null
}

function clip(source: string): string {
  if (source.length <= LONGEST_SOURCE) return source
  const half = LONGEST_SOURCE / 2
  return `${source.slice(0, half)}\n/* ${source.length - LONGEST_SOURCE} characters left out */\n${source.slice(-half)}`
}

export function targetsOf(root: string, map: CodeMap, version: string): Target[] {
  const files = map.folders.flatMap((folder) => folder.files)
  const flat = files.flatMap((file) => file.functions.map((fn) => ({ file: file.path, fn })))
  const edges = edgesOf(map)
  const callers = edges.map((): number[] => [])
  edges.forEach((out, from) => out.forEach((to) => callers[to]?.push(from)))

  const named = (at: number) => (flat[at] ? `${flat[at].file}:${flat[at].fn.name}` : '')
  const sources = new Map<string, string[] | null>()
  return flat.map(({ file, fn }, at) => {
    const target = {
      at,
      name: fn.name,
      file,
      line: fn.line,
      signature: signatureOf(fn.signature),
      inputs: fn.signature?.params.map((param) => param.type ?? '') ?? [],
      output: fn.signature?.returns ?? '',
      callers: (callers[at] ?? []).map(named),
      callees: (edges[at] ?? []).map(named),
      source: clip(linesOf(root, file, sources)?.slice(fn.line - 1, fn.endLine).join('\n') ?? ''),
      test: isTestFile(file),
    }
    const state = stateOf(target)
    return { ...target, state, key: createHash('sha256').update(version).update('\0').update(state).digest('hex') }
  })
}

function stateOf(target: Omit<Target, 'key' | 'state'>): string {
  const { name, file, signature, callers, callees, source } = target
  return JSON.stringify({ function: name, file, signature, calledBy: callers, calls: callees, source })
}
