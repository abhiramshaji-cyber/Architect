import { describe, expect, it } from 'vitest'
import { signatureText } from './signature'

describe('signatureText', () => {
  it('shows nothing when the scan recorded no signature', () => {
    expect(signatureText(undefined)).toBe('')
  })

  it('shows empty parens for a function with no parameters and no written return type', () => {
    expect(signatureText({ params: [] })).toBe('()')
  })

  it('writes generics, every parameter form and the return type as the source wrote them', () => {
    expect(
      signatureText({
        generics: 'T extends object',
        params: [
          { name: 'item', type: 'T' },
          { name: 'label', type: 'string', optional: true },
          { name: 'mode', value: "'all'" },
          { name: 'size', type: 'number', value: '1' },
          { name: 'rest', type: 'T[]', rest: true },
          { name: 'bare' },
        ],
        returns: 'Promise<T>',
      }),
    ).toBe("<T extends object>(item: T, label?: string, mode = 'all', size: number = 1, ...rest: T[], bare): Promise<T>")
  })
})
