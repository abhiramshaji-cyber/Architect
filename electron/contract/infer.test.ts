import { describe, expect, it } from 'vitest'

import type { Architecture, CodeMap, Component, FileEntry } from '../../shared/types'
import { anthropic, infer, judgementOf, promptFor, question, type Judge, type Judgement, type Question } from './infer'

function component(id: string, purpose: string, ...owns: string[]): Component {
  return { id, purpose, owns }
}

function architecture(...components: Component[]): Architecture {
  return { title: 'T', summary: '', components, edges: [], forbidden: [], packages: [] }
}

function file(path: string, fns: { name: string; description?: string; calls?: string[] }[] = []): FileEntry {
  return {
    path,
    functions: fns.map((fn, i) => ({
      name: fn.name,
      line: i + 1,
      endLine: i + 2,
      description: fn.description ?? '',
      calls: (fn.calls ?? []).map((f) => ({ file: f, fn: 0 })),
    })),
  }
}

function map(...files: FileEntry[]): CodeMap {
  const folders = new Map<string, FileEntry[]>()
  for (const f of files) {
    const at = f.path.lastIndexOf('/')
    const dir = at === -1 ? '' : f.path.slice(0, at)
    folders.set(dir, [...(folders.get(dir) ?? []), f])
  }
  return {
    root: '/repo',
    scannedAt: 0,
    folders: [...folders].map(([path, entries]) => ({ path, folders: [], files: entries })),
  }
}

const answer =
  (judgement: Judgement): Judge =>
  async () =>
    judgement

describe('question', () => {
  it('refuses a path a glob already owns', () => {
    const arch = architecture(component('one', 'the one', 'src/**'))
    expect(question('src/a.ts', arch, map(file('src/a.ts')))).toBeNull()
  })

  it('refuses when the contract has no components', () => {
    expect(question('src/a.ts', architecture(), map(file('src/a.ts')))).toBeNull()
  })

  it('refuses a path outside the project', () => {
    const arch = architecture(component('one', 'the one', 'src/**'))
    expect(question('../elsewhere/a.ts', arch, map())).toBeNull()
  })

  it('refuses an empty path', () => {
    const arch = architecture(component('one', 'the one', 'src/**'))
    expect(question('./', arch, map())).toBeNull()
  })

  it('offers every component as a choice', () => {
    const arch = architecture(component('one', 'first', 'src/**'), component('two', 'second', 'lib/**'))
    const q = question('docs/a.ts', arch, map())
    expect(q?.choices).toEqual([
      { id: 'one', purpose: 'first' },
      { id: 'two', purpose: 'second' },
    ])
  })

  it('counts owned siblings in the same folder', () => {
    const arch = architecture(component('one', 'first', 'src/a.ts', 'src/b.ts'), component('two', 'second', 'lib/**'))
    const q = question('src/new.ts', arch, map(file('src/a.ts'), file('src/b.ts'), file('lib/c.ts')))
    expect(q?.nearby).toEqual([{ component: 'one', folder: 2, calls: 0 }])
  })

  it('counts calls in both directions', () => {
    const arch = architecture(component('one', 'first', 'lib/**'))
    const files = map(
      file('src/new.ts', [{ name: 'a', calls: ['lib/c.ts'] }]),
      file('lib/c.ts'),
      file('lib/d.ts', [{ name: 'b', calls: ['src/new.ts'] }]),
    )
    const q = question('src/new.ts', arch, files)
    expect(q?.nearby).toEqual([{ component: 'one', folder: 0, calls: 2 }])
  })

  it('works for a file the scan has never seen', () => {
    const arch = architecture(component('one', 'first', 'src/a.ts'))
    const q = question('src/brand-new.ts', arch, map(file('src/a.ts')))
    expect(q?.path).toBe('src/brand-new.ts')
    expect(q?.does).toEqual([])
    expect(q?.nearby).toEqual([{ component: 'one', folder: 1, calls: 0 }])
  })

  it('carries the descriptions of the file itself', () => {
    const arch = architecture(component('one', 'first', 'src/a.ts'))
    const seen = map(file('src/a.ts'), file('src/new.ts', [{ name: 'go', description: 'does a thing' }]))
    expect(question('src/new.ts', arch, seen)?.does).toEqual(['go: does a thing'])
  })

  it('normalises the path the same way ownership does', () => {
    const arch = architecture(component('one', 'first', 'src/**'))
    expect(question('./src/a.ts', arch, map(file('src/a.ts')))).toBeNull()
    expect(question('src\\a.ts', arch, map(file('src/a.ts')))).toBeNull()
  })

  it('still asks when two components both claim nearby files', () => {
    const arch = architecture(component('one', 'first', 'src/a.ts'), component('two', 'second', 'src/b.ts'))
    const q = question('src/new.ts', arch, map(file('src/a.ts'), file('src/b.ts')))
    expect(q?.nearby).toEqual([
      { component: 'one', folder: 1, calls: 0 },
      { component: 'two', folder: 1, calls: 0 },
    ])
  })

  it('reports a neighbour two components share under both of them', () => {
    const arch = architecture(component('one', 'first', 'src/a.ts'), component('two', 'second', 'src/a.ts'))
    const q = question('src/new.ts', arch, map(file('src/a.ts')))
    expect(q?.nearby).toEqual([
      { component: 'one', folder: 1, calls: 0 },
      { component: 'two', folder: 1, calls: 0 },
    ])
  })
})

describe('promptFor', () => {
  const q: Question = {
    path: 'src/new.ts',
    choices: [
      { id: 'one', purpose: 'first' },
      { id: 'two', purpose: '' },
    ],
    nearby: [{ component: 'one', folder: 2, calls: 1 }],
    does: ['go: does a thing'],
  }

  it('names every choice', () => {
    const text = promptFor(q)
    expect(text).toContain('one')
    expect(text).toContain('two')
  })

  it('states the counted evidence', () => {
    expect(promptFor(q)).toContain('2 file')
  })
})

describe('judgementOf', () => {
  const choices = [{ id: 'one', purpose: 'first' }]

  it('accepts a choice from the closed set', () => {
    expect(judgementOf('{"component":"one","confidence":"certain","why":"it fits"}', choices)).toEqual({
      component: 'one',
      confidence: 'certain',
      why: 'it fits',
    })
  })

  it('accepts a reply wrapped in prose', () => {
    const text = 'Sure thing.\n{"component":"one","confidence":"likely","why":"close"}\nHope that helps.'
    expect(judgementOf(text, choices)?.component).toBe('one')
  })

  it('rejects an id outside the closed set', () => {
    expect(judgementOf('{"component":"three","confidence":"certain","why":"x"}', choices)).toBeNull()
  })

  it('rejects an abstention', () => {
    expect(judgementOf('{"component":null,"confidence":"unsure","why":"nothing fits"}', choices)).toBeNull()
  })

  it('rejects a numeric confidence', () => {
    expect(judgementOf('{"component":"one","confidence":0.92,"why":"x"}', choices)).toBeNull()
  })

  it('rejects an invented confidence word', () => {
    expect(judgementOf('{"component":"one","confidence":"pretty sure","why":"x"}', choices)).toBeNull()
  })

  it('rejects text that is not json', () => {
    expect(judgementOf('I think it belongs to one.', choices)).toBeNull()
  })

  it('rejects empty text', () => {
    expect(judgementOf('', choices)).toBeNull()
  })

  it('rejects a json array', () => {
    expect(judgementOf('["one"]', choices)).toBeNull()
  })

  it('tolerates a missing why', () => {
    expect(judgementOf('{"component":"one","confidence":"likely"}', choices)?.why).toBe('')
  })
})

describe('infer', () => {
  const arch = architecture(component('one', 'first', 'src/a.ts'), component('two', 'second', 'lib/**'))
  const files = map(file('src/a.ts'), file('lib/c.ts'))

  it('returns the chosen component with its confidence', async () => {
    const got = await infer('src/new.ts', arch, files, answer({ component: 'two', confidence: 'likely', why: 'x' }))
    expect(got).toEqual({ path: 'src/new.ts', component: 'two', confidence: 'likely', why: 'x' })
  })

  it('returns null when the judge abstains', async () => {
    expect(await infer('src/new.ts', arch, files, async () => null)).toBeNull()
  })

  it('returns null when the judge names a component that does not exist', async () => {
    const rogue: Judge = async () => ({ component: 'ghost', confidence: 'certain', why: 'x' })
    expect(await infer('src/new.ts', arch, files, rogue)).toBeNull()
  })

  it('returns null when the judge throws', async () => {
    const broken: Judge = async () => {
      throw new Error('provider down')
    }
    expect(await infer('src/new.ts', arch, files, broken)).toBeNull()
  })

  it('never asks the judge about a file a glob already owns', async () => {
    let asked = 0
    const counting: Judge = async () => {
      asked++
      return { component: 'one', confidence: 'certain', why: 'x' }
    }
    expect(await infer('src/a.ts', arch, files, counting)).toBeNull()
    expect(asked).toBe(0)
  })

  it('never asks the judge when there is no contract', async () => {
    let asked = 0
    const counting: Judge = async () => {
      asked++
      return null
    }
    await infer('src/new.ts', architecture(), files, counting)
    expect(asked).toBe(0)
  })

  it('hands the judge the deterministic question unchanged', async () => {
    let seen: Question | undefined
    const spy: Judge = async (q) => {
      seen = q
      return null
    }
    await infer('src/new.ts', arch, files, spy)
    expect(seen).toEqual(question('src/new.ts', arch, files))
  })
})

describe('anthropic', () => {
  const swap = async (key: string | undefined, fetcher: typeof fetch, body: () => Promise<void>) => {
    const had = process.env.ANTHROPIC_API_KEY
    const real = globalThis.fetch
    if (key === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = key
    globalThis.fetch = fetcher
    try {
      await body()
    } finally {
      globalThis.fetch = real
      if (had === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = had
    }
  }

  const asked = () => question('src/new.ts', architecture(component('one', 'first', 'src/a.ts')), map(file('src/a.ts')))

  it('answers nothing and calls nobody with no api key', async () => {
    let calls = 0
    const counting = (async () => {
      calls++
      throw new Error('should not be reached')
    }) as typeof fetch

    await swap(undefined, counting, async () => {
      expect(await anthropic(asked() as Question)).toBeNull()
      expect(calls).toBe(0)
    })
  })

  it('answers nothing when the provider fails', async () => {
    const broken = (async () => {
      throw new Error('network down')
    }) as typeof fetch

    await swap('test-key', broken, async () => {
      expect(await anthropic(asked() as Question)).toBeNull()
    })
  })

  it('reads a well formed reply from the provider', async () => {
    const reply = '{"component":"one","confidence":"certain","why":"it parses"}'
    const ok = (async () =>
      new Response(JSON.stringify({ content: [{ text: reply }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch

    await swap('test-key', ok, async () => {
      expect(await anthropic(asked() as Question)).toEqual({
        component: 'one',
        confidence: 'certain',
        why: 'it parses',
      })
    })
  })
})

describe('input regions', () => {
  const arch = architecture(component('one', 'first', 'src/**'), component('two', 'second', 'src/a.ts'))

  it('refuses the parent directory itself', () => {
    expect(question('..', arch, map())).toBeNull()
  })

  it('reads an absolute path as a project relative one', () => {
    expect(question('/src/a.ts', arch, map(file('src/a.ts')))).toBeNull()
  })

  it('refuses a path two components already share', () => {
    expect(question('src/a.ts', arch, map(file('src/a.ts')))).toBeNull()
  })

  it('asks about a file in a repo whose contract owns nothing', () => {
    const bare = architecture(component('one', 'first'), component('two', 'second'))
    const q = question('src/new.ts', bare, map(file('src/a.ts')))
    expect(q?.nearby).toEqual([])
    expect(q?.choices).toHaveLength(2)
  })

  it('gives the provider a deadline and answers nothing when it expires', async () => {
    const had = process.env.ANTHROPIC_API_KEY
    const real = globalThis.fetch
    let seen: AbortSignal | null = null
    process.env.ANTHROPIC_API_KEY = 'test-key'
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        seen = init?.signal ?? null
        if (!seen) return reject(new Error('the request carried no deadline'))
        setTimeout(() => reject(new DOMException('timed out', 'TimeoutError')), 5)
      })) as typeof fetch

    try {
      const q = question('src/new.ts', architecture(component('one', 'first')), map())
      expect(await anthropic(q as Question)).toBeNull()
      expect(seen).toBeInstanceOf(AbortSignal)
    } finally {
      globalThis.fetch = real
      if (had === undefined) delete process.env.ANTHROPIC_API_KEY
      else process.env.ANTHROPIC_API_KEY = had
    }
  })
})
