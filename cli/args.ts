import path from 'node:path'

export type Args = { root: string; json: boolean; help: boolean; history: boolean }

export const USAGE_TEXT = [
  'architect check [path] [--json] [--history]',
  '',
  '  path       directory holding architect.md (default: the working directory)',
  '  --json     emit the report as JSON',
  '  --history  list the stored pass and fail runs of each rule instead of checking',
  '',
  'exit 0 the architecture and its rules are satisfied',
  'exit 1 the code violates the drawing or a rule',
  'exit 2 bad usage, missing or malformed architect.md',
].join('\n')

export function parseArgs(argv: string[]): Args | string {
  const rest = argv[0] === 'check' ? argv.slice(1) : argv
  let root: string | undefined
  let json = false
  let history = false

  for (const arg of rest) {
    if (arg === '--help' || arg === '-h') return { root: process.cwd(), json: false, help: true, history: false }
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg === '--history') {
      history = true
      continue
    }
    if (arg.startsWith('-')) return `unknown option: ${arg}`
    if (root !== undefined) return `unexpected extra argument: ${arg}`
    root = arg
  }

  return { root: path.resolve(root ?? process.cwd()), json, help: false, history }
}
