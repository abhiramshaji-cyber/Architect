import { describe, expect, it } from 'vitest'
import type { ReactFlowState } from '@xyflow/react'
import { PILL_ZOOM, farOf } from './Card'

const at = (zoom: number) => ({ transform: [0, 0, zoom] }) as unknown as ReactFlowState

describe('farOf', () => {
  it('switches to pills only below the threshold zoom', () => {
    expect(farOf(at(1))).toBe(false)
    expect(farOf(at(PILL_ZOOM))).toBe(false)
    expect(farOf(at(PILL_ZOOM - 0.01))).toBe(true)
    expect(farOf(at(0.05))).toBe(true)
  })
})
