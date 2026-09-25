import { describe, expect, it } from 'vitest'
import { latchedRoot } from './TerminalView'

describe('the directory a terminal is bound to', () => {
  it('takes the root open at the moment it is created', () => {
    expect(latchedRoot(null, '/repo/main')).toBe('/repo/main')
  })

  it('waits for a project rather than binding to nothing', () => {
    expect(latchedRoot(null, null)).toBe(null)
  })

  it('does not move when the project or worktree changes under a live session', () => {
    expect(latchedRoot('/repo/main', '/repo/feature')).toBe('/repo/main')
  })

  it('survives the project being closed', () => {
    expect(latchedRoot('/repo/main', null)).toBe('/repo/main')
  })
})
