import path from 'node:path'
import type { WhereInput } from '../electron/where'

export type Args = { command: 'check' | 'agents' | 'where'; root: string; json: boolean; help: boolean; history: boolean; where?: WhereInput; suggest?: true }

export const USAGE_TEXT = [
  'architect check [path] [--json] [--history] [--suggest]',
  'architect agents [path] [--json]',
  'architect where [path] [--calls ref]... [--callers ref]... [--name name] [--file file] [--json]',
  '',
  '  check      check the code against the drawing and the Rules section',
  '  agents     write an AGENTS.md in each component folder from architect.md',
  '  where      name the component, folder, naming word and closest function for a new function',
  '  path       directory holding architect.md (default: the working directory)',
  '  --json     emit the report as JSON',
  '  --history  list the stored pass and fail runs of each rule instead of checking',
  '  --calls    a function the new one will call: name, file, or file:name (repeatable)',
  '  --callers  a function or file that will call the new one (repeatable)',
  '  --name     the proposed function name',
  '  --file     the proposed file, checked against the Rules',
  '  --suggest  also list split suggestions for long or many job files and for long functions with many callers',
  '',
  'exit 0 the architecture and its rules are satisfied',
  'exit 1 the code violates the drawing or a rule',
  'exit 2 bad usage, missing or malformed architect.md',
  '',
  'agents exits 0 once written, listing components it could not place',
  'where exits 0 once answered, and reads files relative to the working directory, else to path',
].join('\n')

const COMMANDS = ['check', 'agents', 'where'] as const

const VALUED = new Set(['--calls', '--callers', '--name', '--file'])

export function parseArgs(argv: string[]): Args | string {
  const named = COMMANDS.find((command) => command === argv[0])
  const command = named ?? 'check'
  const rest = named ? argv.slice(1) : argv
  const where: WhereInput = { calls: [], callers: [] }
  let root: string | undefined
  let json = false
  let history = false
  let suggest = false

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i] as string
    if (arg === '--help' || arg === '-h') return { command, root: process.cwd(), json: false, help: true, history: false }
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg === '--history' && command === 'check') {
      history = true
      continue
    }
    if (arg === '--suggest' && command === 'check') {
      suggest = true
      continue
    }
    const [flag = arg, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg]
    if (command === 'where' && VALUED.has(flag)) {
      const value = inline ?? rest[++i]
      if (value === undefined || value === '' || (inline === undefined && value.startsWith('--'))) return `${flag} needs a value`
      if (flag === '--calls') where.calls.push(value)
      else if (flag === '--callers') where.callers.push(value)
      else where[flag === '--name' ? 'name' : 'file'] = value
      continue
    }
    if (arg.startsWith('-')) return `unknown option: ${arg}`
    if (root !== undefined) return `unexpected extra argument: ${arg}`
    root = arg
  }

  if (suggest && history) return '--suggest checks and --history lists past runs, pass one'
  const parsed: Args = { command, root: path.resolve(root ?? process.cwd()), json, help: false, history, ...(suggest ? { suggest: true as const } : {}) }
  return command === 'where' ? { ...parsed, where } : parsed
}
