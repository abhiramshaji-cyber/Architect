import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPtyHost, type PtyProcess, type PtySpawner } from './pty'
import type { PtyEvent } from '../../shared/types'

type Fake = PtyProcess & {
  emit(data: string): void
  finish(exitCode: number, signal?: number): void
  written: string[]
  sizes: [number, number][]
  kills: (string | undefined)[]
  options: { name: string; cwd: string; cols: number; rows: number; env: Record<string, string> }
  file: string
  args: string[]
}

function fakes() {
  const made: Fake[] = []

  const spawn: PtySpawner = (file, args, options) => {
    const data: ((d: string) => void)[] = []
    const exit: ((e: { exitCode: number; signal?: number }) => void)[] = []

    const fake: Fake = {
      pid: 1000 + made.length,
      file,
      args,
      options,
      written: [],
      sizes: [],
      kills: [],
      onData: (listener) => {
        data.push(listener)
        return { dispose: () => data.splice(data.indexOf(listener), 1) }
      },
      onExit: (listener) => {
        exit.push(listener)
        return { dispose: () => exit.splice(exit.indexOf(listener), 1) }
      },
      write: (d) => {
        fake.written.push(d)
      },
      resize: (cols, rows) => {
        fake.sizes.push([cols, rows])
      },
      kill: (signal) => {
        fake.kills.push(signal)
      },
      emit: (d) => {
        for (const listener of [...data]) listener(d)
      },
      finish: (exitCode, signal) => {
        for (const listener of [...exit]) listener({ exitCode, signal })
      },
    }

    made.push(fake)
    return fake
  }

  return { spawn, made }
}

function host(spawn: PtySpawner) {
  const events: PtyEvent[] = []
  return { host: createPtyHost(spawn, (event) => events.push(event)), events }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('spawn', () => {
  it('returns an id and the child pid', () => {
    const { spawn, made } = fakes()
    const started = host(spawn).host.spawn({ cwd: '/tmp', cols: 80, rows: 24 })

    expect(started.id).toHaveLength(36)
    expect(started.pid).toBe(made[0]?.pid)
  })

  it('passes the requested shell, cwd and size to the child', () => {
    const { spawn, made } = fakes()
    host(spawn).host.spawn({ cwd: '/tmp/work', shell: '/bin/zsh', args: ['-l'], cols: 100, rows: 40 })

    expect(made[0]?.file).toBe('/bin/zsh')
    expect(made[0]?.args).toEqual(['-l'])
    expect(made[0]?.options.cwd).toBe('/tmp/work')
    expect(made[0]?.options.cols).toBe(100)
    expect(made[0]?.options.rows).toBe(40)
    expect(made[0]?.options.env.TERM).toBe('xterm-256color')
  })

  it('clamps a zero or fractional size to a usable one', () => {
    const { spawn, made } = fakes()
    host(spawn).host.spawn({ cwd: '/tmp', cols: 0, rows: 24.7 })

    expect(made[0]?.options.cols).toBe(1)
    expect(made[0]?.options.rows).toBe(24)
  })

  it('falls back to a standard size when the pane reports no measurement', () => {
    const { spawn, made } = fakes()
    host(spawn).host.spawn({ cwd: '/tmp', cols: Number.NaN, rows: Number.POSITIVE_INFINITY })

    expect(made[0]?.options.cols).toBe(80)
    expect(made[0]?.options.rows).toBe(24)
  })

  it('propagates a spawn failure to the caller and registers nothing', () => {
    const failing: PtySpawner = () => {
      throw new Error('posix_spawnp failed')
    }
    const { host: h } = host(failing)

    expect(() => h.spawn({ cwd: '/nope', cols: 80, rows: 24 })).toThrow('posix_spawnp failed')
    expect(h.ids()).toEqual([])
  })

  it('keeps concurrent sessions apart', () => {
    const { spawn, made } = fakes()
    const { host: h, events } = host(spawn)
    const one = h.spawn({ cwd: '/a', cols: 80, rows: 24 })
    const two = h.spawn({ cwd: '/b', cols: 80, rows: 24 })

    made[0]?.emit('from-one')
    made[1]?.emit('from-two')
    vi.advanceTimersByTime(50)

    expect(h.ids()).toEqual([one.id, two.id])
    expect(events).toEqual([
      { type: 'data', id: one.id, chunk: 'from-one' },
      { type: 'data', id: two.id, chunk: 'from-two' },
    ])
  })
})

describe('streaming', () => {
  it('batches several bursts into one chunk', () => {
    const { spawn, made } = fakes()
    const { host: h, events } = host(spawn)
    const started = h.spawn({ cwd: '/tmp', cols: 80, rows: 24 })

    made[0]?.emit('a')
    made[0]?.emit('b')
    made[0]?.emit('c')
    expect(events).toEqual([])

    vi.advanceTimersByTime(10)
    expect(events).toEqual([{ type: 'data', id: started.id, chunk: 'abc' }])
  })

  it('flushes immediately once a burst passes the chunk size', () => {
    const { spawn, made } = fakes()
    const { host: h, events } = host(spawn)
    h.spawn({ cwd: '/tmp', cols: 80, rows: 24 })

    made[0]?.emit('x'.repeat(64 * 1024))

    expect(events).toHaveLength(1)
  })

  it('drops the oldest output rather than buffering without limit', () => {
    const { spawn, made } = fakes()
    const { host: h, events } = host(spawn)
    h.spawn({ cwd: '/tmp', cols: 80, rows: 24 })

    made[0]?.emit('head' + 'y'.repeat(2 * 1024 * 1024))
    vi.advanceTimersByTime(10)

    const total = events.reduce((sum, event) => sum + (event.type === 'data' ? event.chunk.length : 0), 0)
    expect(total).toBeLessThanOrEqual(1024 * 1024)
    expect(events.some((event) => event.type === 'data' && event.chunk.startsWith('head'))).toBe(false)
  })
})

describe('write', () => {
  it('forwards input to the child', () => {
    const { spawn, made } = fakes()
    const { host: h } = host(spawn)
    const started = h.spawn({ cwd: '/tmp', cols: 80, rows: 24 })

    expect(h.write(started.id, 'ls\r')).toBe(true)
    expect(made[0]?.written).toEqual(['ls\r'])
  })

  it('refuses an unknown session', () => {
    const { spawn } = fakes()
    expect(host(spawn).host.write('missing', 'ls')).toBe(false)
  })

  it('refuses a session that already exited', () => {
    const { spawn, made } = fakes()
    const { host: h } = host(spawn)
    const started = h.spawn({ cwd: '/tmp', cols: 80, rows: 24 })
    made[0]?.finish(0)

    expect(h.write(started.id, 'ls')).toBe(false)
  })

  it('survives a child that throws on write', () => {
    const { spawn, made } = fakes()
    const { host: h } = host(spawn)
    const started = h.spawn({ cwd: '/tmp', cols: 80, rows: 24 })
    const fake = made[0]
    if (!fake) throw new Error('no child')
    fake.write = () => {
      throw new Error('EIO')
    }

    expect(h.write(started.id, 'ls')).toBe(false)
  })
})

describe('resize', () => {
  it('propagates the new size to the child', () => {
    const { spawn, made } = fakes()
    const { host: h } = host(spawn)
    const started = h.spawn({ cwd: '/tmp', cols: 80, rows: 24 })

    expect(h.resize(started.id, 120.9, 50)).toBe(true)
    expect(made[0]?.sizes).toEqual([[120, 50]])
  })

  it('clamps a collapsed pane to one cell', () => {
    const { spawn, made } = fakes()
    const { host: h } = host(spawn)
    const started = h.spawn({ cwd: '/tmp', cols: 80, rows: 24 })
    h.resize(started.id, 0, -4)

    expect(made[0]?.sizes).toEqual([[1, 1]])
  })

  it('rejects a size that is not a number', () => {
    const { spawn, made } = fakes()
    const { host: h } = host(spawn)
    const started = h.spawn({ cwd: '/tmp', cols: 80, rows: 24 })

    expect(h.resize(started.id, Number.NaN, 50)).toBe(false)
    expect(made[0]?.sizes).toEqual([])
  })

  it('refuses an unknown session', () => {
    const { spawn } = fakes()
    expect(host(spawn).host.resize('missing', 80, 24)).toBe(false)
  })
})

describe('exit', () => {
  it('reports the exit code and signal and forgets the session', () => {
    const { spawn, made } = fakes()
    const { host: h, events } = host(spawn)
    const started = h.spawn({ cwd: '/tmp', cols: 80, rows: 24 })
    made[0]?.finish(3, 9)

    expect(events).toContainEqual({ type: 'exit', id: started.id, exitCode: 3, signal: 9 })
    expect(h.ids()).toEqual([])
  })

  it('flushes buffered output before the exit event', () => {
    const { spawn, made } = fakes()
    const { host: h, events } = host(spawn)
    const started = h.spawn({ cwd: '/tmp', cols: 80, rows: 24 })

    made[0]?.emit('bye')
    made[0]?.finish(0)

    expect(events).toEqual([
      { type: 'data', id: started.id, chunk: 'bye' },
      { type: 'exit', id: started.id, exitCode: 0, signal: undefined },
    ])
  })

  it('reports exit once when the child fires it twice', () => {
    const { spawn, made } = fakes()
    const { host: h, events } = host(spawn)
    h.spawn({ cwd: '/tmp', cols: 80, rows: 24 })
    made[0]?.finish(0)
    made[0]?.finish(0)

    expect(events.filter((event) => event.type === 'exit')).toHaveLength(1)
  })

  it('emits nothing for output arriving after exit', () => {
    const { spawn, made } = fakes()
    const { host: h, events } = host(spawn)
    h.spawn({ cwd: '/tmp', cols: 80, rows: 24 })
    made[0]?.finish(0)
    made[0]?.emit('ghost')
    vi.advanceTimersByTime(50)

    expect(events.filter((event) => event.type === 'data')).toEqual([])
  })
})

describe('kill', () => {
  it('signals the child and reports the exit once it dies', () => {
    const { spawn, made } = fakes()
    const { host: h, events } = host(spawn)
    const started = h.spawn({ cwd: '/tmp', cols: 80, rows: 24 })

    expect(h.kill(started.id)).toBe(true)
    expect(made[0]?.kills).toHaveLength(1)

    made[0]?.finish(0, 1)
    expect(events).toContainEqual({ type: 'exit', id: started.id, exitCode: 0, signal: 1 })
  })

  it('is a no-op the second time', () => {
    const { spawn, made } = fakes()
    const { host: h } = host(spawn)
    const started = h.spawn({ cwd: '/tmp', cols: 80, rows: 24 })

    expect(h.kill(started.id)).toBe(true)
    expect(h.kill(started.id)).toBe(false)
    expect(made[0]?.kills).toHaveLength(1)
  })

  it('refuses an unknown session', () => {
    const { spawn } = fakes()
    expect(host(spawn).host.kill('missing')).toBe(false)
  })

  it('drops a session whose child throws on kill', () => {
    const { spawn, made } = fakes()
    const { host: h } = host(spawn)
    const started = h.spawn({ cwd: '/tmp', cols: 80, rows: 24 })
    const fake = made[0]
    if (!fake) throw new Error('no child')
    fake.kill = () => {
      throw new Error('ESRCH')
    }

    expect(h.kill(started.id)).toBe(false)
    expect(h.ids()).toEqual([])
  })
})

describe('killAll', () => {
  it('leaves no session behind', () => {
    const { spawn, made } = fakes()
    const { host: h } = host(spawn)
    h.spawn({ cwd: '/a', cols: 80, rows: 24 })
    h.spawn({ cwd: '/b', cols: 80, rows: 24 })

    h.killAll()

    expect(h.ids()).toEqual([])
    expect(made[0]?.kills).toEqual(['SIGKILL'])
    expect(made[1]?.kills).toEqual(['SIGKILL'])
  })

  it('kills the rest when one child throws', () => {
    const { spawn, made } = fakes()
    const { host: h } = host(spawn)
    h.spawn({ cwd: '/a', cols: 80, rows: 24 })
    h.spawn({ cwd: '/b', cols: 80, rows: 24 })
    const fake = made[0]
    if (!fake) throw new Error('no child')
    fake.kill = () => {
      throw new Error('ESRCH')
    }

    h.killAll()

    expect(h.ids()).toEqual([])
    expect(made[1]?.kills).toEqual(['SIGKILL'])
  })

  it('emits no output from a killed session', () => {
    const { spawn, made } = fakes()
    const { host: h, events } = host(spawn)
    h.spawn({ cwd: '/a', cols: 80, rows: 24 })
    made[0]?.emit('pending')
    h.killAll()
    made[0]?.emit('after')
    vi.advanceTimersByTime(50)

    expect(events).toEqual([])
  })
})
