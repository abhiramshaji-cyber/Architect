import { execFile } from 'node:child_process'
import type { SearchHit, SearchResult } from '../../shared/types'

export const MAX_HITS = 500
const MAX_TEXT = 400
const PER_FILE = 50
const TIMEOUT_MS = 10_000
const MAX_OUTPUT = 16 * 1024 * 1024

type Ran = { stdout: string; partial: boolean }

type RgText = { text?: string; bytes?: string }

type RgEvent = { type?: string; data?: { path?: RgText; lines?: RgText; line_number?: number } }

function decode(value: RgText | undefined): string | null {
  if (typeof value?.text === 'string') return value.text
  if (typeof value?.bytes === 'string') return Buffer.from(value.bytes, 'base64').toString('utf8')
  return null
}

function hit(file: string, line: number, text: string): SearchHit {
  return { file: file.replace(/^\.\//, ''), line, text: text.replace(/\r?\n$/, '').slice(0, MAX_TEXT) }
}

function parsed(row: string): RgEvent | null {
  try {
    return JSON.parse(row) as RgEvent
  } catch {
    return null
  }
}

export function parseRg(stdout: string, cap = MAX_HITS): SearchResult {
  const hits: SearchHit[] = []

  for (const row of stdout.split('\n')) {
    const event = row.startsWith('{') ? parsed(row) : null
    if (event?.type !== 'match') continue
    const file = decode(event.data?.path)
    const text = decode(event.data?.lines)
    const line = event.data?.line_number
    if (file === null || text === null || typeof line !== 'number') continue
    if (hits.length === cap) return { hits, capped: true }
    hits.push(hit(file, line, text))
  }

  return { hits, capped: false }
}

export function parseGitGrep(stdout: string, cap = MAX_HITS): SearchResult {
  const hits: SearchHit[] = []

  for (const row of stdout.split('\n')) {
    const [file, line, ...rest] = row.split('\0')
    const number = Number(line)
    if (!file || rest.length === 0 || !Number.isInteger(number) || number < 1) continue
    if (hits.length === cap) return { hits, capped: true }
    hits.push(hit(file, number, rest.join('\0')))
  }

  return { hits, capped: false }
}

function run(command: string, args: string[], cwd: string): Promise<Ran> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT, windowsHide: true, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (!error) return resolve({ stdout, partial: false })
        const partial = error.killed === true || error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
        if (partial || error.code === 1 || (error.code === 2 && stdout !== '')) return resolve({ stdout, partial })
        reject(Object.assign(new Error(stderr.trim() || error.message), { code: error.code }))
      },
    )
  })
}

function ripgrep(root: string, query: string): Promise<Ran | null> {
  const args = ['--json', '--fixed-strings', '--hidden', '--glob', '!.git', '--max-count', String(PER_FILE), '-e', query, './']
  return run('rg', args, root).catch((error: { code?: unknown }) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
}

function gitGrep(root: string, query: string): Promise<Ran> {
  const flags = ['grep', '-n', '-I', '-z', '--no-color', '--fixed-strings', '--exclude-standard']
  return run('git', [...flags, '--untracked', '-e', query, '--'], root).catch(() =>
    run('git', [...flags, '--no-index', '-e', query, '--'], root),
  )
}

export async function search(root: string, query: string): Promise<SearchResult> {
  if (query === '') return { hits: [], capped: false }

  const rg = await ripgrep(root, query)
  const ran = rg ?? (await gitGrep(root, query))
  const result = rg ? parseRg(ran.stdout) : parseGitGrep(ran.stdout)
  return ran.partial ? { ...result, capped: true } : result
}
