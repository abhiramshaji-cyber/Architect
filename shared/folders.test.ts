import { describe, expect, it } from 'vitest'
import { folderShaped, topsOf } from './folders'
import type { Architecture, Component } from './types'

const contract = (components: Component[], scope?: string): Architecture => ({
  title: 't',
  summary: 's',
  components,
  edges: [],
  forbidden: [],
  packages: [],
  ...(scope && { scope }),
})

describe('topsOf', () => {
  it('lists the top level folders that hold files, inside the scope', () => {
    expect(topsOf(['src/a.ts', 'src/b/c.ts', 'tests/x.ts', 'index.ts'])).toEqual(['src', 'tests'])
    expect(topsOf(['spec/bot/a.ts', 'spec/x.ts', 'zing/y.ts'], 'spec')).toEqual(['bot'])
  })
})

describe('folderShaped', () => {
  const tops = ['scripts', 'src', 'tests']

  it('catches components that are just the top level folders', () => {
    const folders = contract([
      { id: 'scripts', purpose: '', owns: ['scripts/**'] },
      { id: 'src', purpose: '', owns: ['src/**'] },
      { id: 'tests', purpose: '', owns: ['tests/**'] },
    ])
    expect(folderShaped(folders, tops)).toBe(true)
  })

  it('catches a folder renamed or a folder named with no globs, and ignores outside services', () => {
    const folders = contract([
      { id: 'bot', purpose: '', owns: ['./src/**'] },
      { id: 'tests', purpose: '', owns: [] },
      { id: 'openai', purpose: '', owns: [] },
    ])
    expect(folderShaped(folders, tops)).toBe(true)
  })

  it('passes a flow chart whose components split the folders by job', () => {
    const flow = contract([
      { id: 'conversation', purpose: '', owns: ['src/conversations/**'] },
      { id: 'tools', purpose: '', owns: ['src/tools/**'] },
      { id: 'llm', purpose: '', owns: [] },
    ])
    expect(folderShaped(flow, tops)).toBe(false)
  })

  it('reads the globs relative to the contract scope', () => {
    const scoped = contract([{ id: 'agent', purpose: '', owns: ['spec/bot/**'] }], 'spec')
    expect(folderShaped(scoped, ['bot'])).toBe(true)
    expect(folderShaped(contract([{ id: 'agent', purpose: '', owns: ['spec/bot/**'] }]), ['bot'])).toBe(false)
  })

  it('never flags an empty contract or a flat repo with no folders', () => {
    expect(folderShaped(contract([]), tops)).toBe(false)
    expect(folderShaped(contract([{ id: 'app', purpose: '', owns: ['index.ts'] }]), [])).toBe(false)
  })
})
