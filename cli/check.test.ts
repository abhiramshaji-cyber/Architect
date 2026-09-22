import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { OK, USAGE, VIOLATED, audit, parseArgs, report, run } from './check'
import { parse } from '../electron/contract/graph'
import { scan } from '../electron/scan/scan'

const roots: string[] = []

function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'architect-cli-'))
  roots.push(root)

  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }

  return root
}

function contract(extra: { edges?: string[]; forbidden?: string[] } = {}): string {
  return [
    '# Demo',
    '',
    'A two component demo.',
    '',
    '## Components',
    '',
    '### api',
    'The http surface.',
    'owns: `api/**`',
    '',
    '### store',
    'The database.',
    'owns: `store/**`',
    '',
    '## Dependencies',
    '',
    ...(extra.edges ?? []),
    '',
    '## Forbidden',
    '',
    ...(extra.forbidden ?? []),
    '',
  ].join('\n')
}

const API = 'import { load } from "../store/db"\n\nexport function handle() {\n  return load()\n}\n'
const STORE = 'export function load() {\n  return 1\n}\n'

async function outcome(root: string, argv: string[] = []): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = []
  const err: string[] = []
  const code = await run([...argv, root], (l) => out.push(l), (l) => err.push(l))
  return { code, out: out.join('\n'), err: err.join('\n') }
}

afterEach(() => {
  while (roots.length > 0) fs.rmSync(roots.pop() as string, { recursive: true, force: true })
})

describe('parseArgs', () => {
  it('defaults to the working directory', () => {
    expect(parseArgs([])).toEqual({ root: process.cwd(), json: false, help: false })
  })

  it('consumes a leading check subcommand', () => {
    expect(parseArgs(['check', '/tmp'])).toEqual({ root: path.resolve('/tmp'), json: false, help: false })
  })

  it('reads the json flag in any position', () => {
    expect(parseArgs(['--json', '/tmp'])).toEqual({ root: path.resolve('/tmp'), json: true, help: false })
  })

  it('rejects an unknown option', () => {
    expect(parseArgs(['--deep'])).toBe('unknown option: --deep')
  })

  it('rejects a second path', () => {
    expect(parseArgs(['/a', '/b'])).toBe('unexpected extra argument: /b')
  })

  it('treats help as a flag', () => {
    expect(parseArgs(['-h'])).toEqual({ root: process.cwd(), json: false, help: true })
  })
})

describe('audit', () => {
  it('finds nothing when the edge is drawn', async () => {
    const root = fixture({ 'api/handler.ts': API, 'store/db.ts': STORE })
    expect(audit(parse(contract({ edges: ['- api -> store'] })), await scan(root))).toEqual([])
  })

  it('reports an undrawn edge with the calling files', async () => {
    const root = fixture({ 'api/handler.ts': API, 'store/db.ts': STORE })
    const violations = audit(parse(contract()), await scan(root))

    expect(violations).toHaveLength(1)
    expect(violations[0]?.from).toBe('api')
    expect(violations[0]?.to).toBe('store')
    expect(violations[0]?.verdict.status).toBe('undrawn-edge')
    expect(violations[0]?.evidence).toEqual([{ from: 'api/handler.ts', to: 'store/db.ts' }])
  })

  it('reports a forbidden edge with its reason', async () => {
    const root = fixture({ 'api/handler.ts': API, 'store/db.ts': STORE })
    const violations = audit(parse(contract({ forbidden: ['- api -> store : go through the service'] })), await scan(root))

    expect(violations[0]?.verdict).toEqual({ status: 'forbidden', reason: 'go through the service' })
  })

  it('ignores calls inside one component', async () => {
    const root = fixture({
      'api/handler.ts': 'import { load } from "./db"\n\nexport function handle() {\n  return load()\n}\n',
      'api/db.ts': STORE,
    })
    expect(audit(parse(contract()), await scan(root))).toEqual([])
  })

  it('ignores calls into a file no component owns', async () => {
    const root = fixture({
      'api/handler.ts': 'import { load } from "../vendor/db"\n\nexport function handle() {\n  return load()\n}\n',
      'vendor/db.ts': STORE,
    })
    expect(audit(parse(contract()), await scan(root))).toEqual([])
  })

  it('collapses many offending files into one edge', async () => {
    const root = fixture({
      'api/a.ts': API,
      'api/b.ts': API,
      'store/db.ts': STORE,
    })
    const violations = audit(parse(contract()), await scan(root))

    expect(violations).toHaveLength(1)
    expect(violations[0]?.evidence).toHaveLength(2)
  })
})

describe('report', () => {
  it('states the contract is satisfied', () => {
    expect(report(parse(contract()), [])).toBe('architect: Demo satisfied, no violations')
  })

  it('names every violation and its evidence', () => {
    const text = report(parse(contract()), [
      { from: 'api', to: 'store', verdict: { status: 'undrawn-edge' }, evidence: [{ from: 'api/a.ts', to: 'store/db.ts' }] },
      { from: 'store', to: 'api', verdict: { status: 'forbidden', reason: 'no back edge' }, evidence: [] },
    ])

    expect(text).toContain('2 violations')
    expect(text).toContain('api -> store')
    expect(text).toContain('api/a.ts calls store/db.ts')
    expect(text).toContain('forbidden: no back edge')
  })
})

describe('run', () => {
  it('exits 0 when the architecture is satisfied', async () => {
    const root = fixture({ 'architect.md': contract({ edges: ['- api -> store'] }), 'api/handler.ts': API, 'store/db.ts': STORE })
    const result = await outcome(root)

    expect(result.code).toBe(OK)
    expect(result.out).toContain('satisfied')
  })

  it('exits 1 when the drawing is violated', async () => {
    const root = fixture({ 'architect.md': contract(), 'api/handler.ts': API, 'store/db.ts': STORE })
    const result = await outcome(root)

    expect(result.code).toBe(VIOLATED)
    expect(result.out).toContain('api -> store')
  })

  it('exits 2 when there is no architect.md', async () => {
    const root = fixture({ 'api/handler.ts': API })
    const result = await outcome(root)

    expect(result.code).toBe(USAGE)
    expect(result.err).toContain('no architect.md')
  })

  it('exits 2 when architect.md is malformed', async () => {
    const root = fixture({ 'architect.md': '# Bad\n\n## Dependencies\n\n- api -> ghost\n' })
    const result = await outcome(root)

    expect(result.code).toBe(USAGE)
    expect(result.err).toContain('could not parse')
  })

  it('exits 2 when the path is not a directory', async () => {
    const root = fixture({ 'architect.md': contract() })
    const out: string[] = []
    const err: string[] = []
    const code = await run([path.join(root, 'architect.md')], (l) => out.push(l), (l) => err.push(l))

    expect(code).toBe(USAGE)
    expect(err.join('\n')).toContain('not a directory')
  })

  it('exits 2 on an unknown option without scanning', async () => {
    const result = await outcome('/nowhere', ['--deep'])

    expect(result.code).toBe(USAGE)
    expect(result.err).toContain('unknown option')
    expect(result.err).toContain('architect check [path]')
  })

  it('prints usage and exits 0 for help', async () => {
    const result = await outcome('/nowhere', ['--help'])

    expect(result.code).toBe(OK)
    expect(result.out).toContain('exit 1 the code violates the drawing')
  })

  it('emits machine readable json while keeping the exit code', async () => {
    const root = fixture({ 'architect.md': contract(), 'api/handler.ts': API, 'store/db.ts': STORE })
    const result = await outcome(root, ['check', '--json'])

    expect(result.code).toBe(VIOLATED)
    expect(JSON.parse(result.out).violations[0].from).toBe('api')
  })

  it('reports every violation when there are many', async () => {
    const root = fixture({
      'architect.md': contract(),
      'api/handler.ts': API,
      'store/db.ts': 'import { handle } from "../api/handler"\n\nexport function load() {\n  return handle()\n}\n',
    })
    const result = await outcome(root)

    expect(result.code).toBe(VIOLATED)
    expect(result.out).toContain('2 violations')
    expect(result.out).toContain('store -> api')
  })
})

describe('missing paths', () => {
  it('exits 2 when the path does not exist', async () => {
    const err: string[] = []
    const code = await run(['/no/such/place'], () => {}, (l) => err.push(l))

    expect(code).toBe(USAGE)
    expect(err.join('\n')).toContain('no such directory')
  })
})
