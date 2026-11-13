import path from 'node:path'
import { realPath } from '../../shared/disk/real'
import type { CodeMap } from '../../shared/types'

export type Fn = { file: string; name: string; line: number; test: boolean }

export type Resolved = {
  ref: string
  status: 'function' | 'file' | 'ambiguous' | 'none'
  files: string[]
  fns: number[]
  matches: string[]
}

export function projectPath(root: string, cwd: string, file: string): string {
  return path.relative(realPath(root), realPath(path.resolve(cwd, file))).split(path.sep).join('/')
}

const at = (fn: Fn) => `${fn.file}:${fn.line}`

const calledBy = (fn: Fn, name: string) => fn.name === name || fn.name.endsWith(`.${name}`)

function named(fns: Fn[], indexes: number[], ref: string): Resolved {
  const files = [...new Set(indexes.map((i) => fns[i]?.file ?? ''))]
  const matches = indexes.flatMap((i) => (fns[i] ? [`${at(fns[i])} ${fns[i].name}`] : []))
  if (indexes.length === 0) return { ref, status: 'none', files: [], fns: [], matches }
  if (files.length > 1) return { ref, status: 'ambiguous', files: [], fns: [], matches }
  return { ref, status: 'function', files, fns: indexes, matches }
}

function knownPath(known: Set<string>, root: string, cwd: string, file: string): string | undefined {
  return [projectPath(root, cwd, file), projectPath(root, root, file)].find((candidate) => known.has(candidate))
}

function resolveOne(fns: Fn[], known: Set<string>, root: string, cwd: string, ref: string): Resolved {
  const whole = knownPath(known, root, cwd, ref)
  if (whole !== undefined) {
    const inFile = fns.flatMap((fn, i) => (fn.file === whole ? [i] : []))
    return { ref, status: 'file', files: [whole], fns: inFile, matches: [`${whole}:1`] }
  }

  const colon = ref.lastIndexOf(':')
  const file = colon > 0 ? knownPath(known, root, cwd, ref.slice(0, colon)) : undefined
  if (file !== undefined) {
    const name = ref.slice(colon + 1)
    return named(fns, fns.flatMap((fn, i) => (fn.file === file && calledBy(fn, name) ? [i] : [])), ref)
  }

  return named(fns, fns.flatMap((fn, i) => (!fn.test && calledBy(fn, ref) ? [i] : [])), ref)
}

export function resolveRefs(fns: Fn[], map: CodeMap, root: string, cwd: string, refs: string[]): Resolved[] {
  const known = new Set(map.folders.flatMap((folder) => folder.files.map((file) => file.path)))
  return [...new Set(refs.map((ref) => ref.trim()).filter((ref) => ref !== ''))].map((ref) => resolveOne(fns, known, root, cwd, ref))
}
