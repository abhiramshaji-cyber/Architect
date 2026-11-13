import { describe, expect, it } from 'vitest'
import { wordParts } from './Name'

describe('wordParts', () => {
  it('splits camelCase and PascalCase', () => {
    expect(wordParts('makeSearchFsaKnowledgeTool')).toEqual(['make', 'Search', 'Fsa', 'Knowledge', 'Tool'])
    expect(wordParts('CodeCanvas')).toEqual(['Code', 'Canvas'])
  })

  it('keeps acronyms whole', () => {
    expect(wordParts('parseHTTPResponse')).toEqual(['parse', 'HTTP', 'Response'])
    expect(wordParts('toJSON')).toEqual(['to', 'JSON'])
  })

  it('splits after digits and separators', () => {
    expect(wordParts('v2Parser')).toEqual(['v2', 'Parser'])
    expect(wordParts('load_user__data')).toEqual(['load_', 'user__', 'data'])
    expect(wordParts('searchFsaKnowledge.ts')).toEqual(['search', 'Fsa', 'Knowledge.', 'ts'])
    expect(wordParts('kebab-case/path')).toEqual(['kebab-', 'case/', 'path'])
  })

  it('never splits leading or trailing separators off alone', () => {
    expect(wordParts('_private')).toEqual(['_private'])
    expect(wordParts('__init__')).toEqual(['__init__'])
    expect(wordParts('$el')).toEqual(['$el'])
  })

  it('leaves plain and non latin words whole', () => {
    expect(wordParts('main')).toEqual(['main'])
    expect(wordParts('')).toEqual([''])
    expect(wordParts('größeÄndern')).toEqual(['größe', 'Ändern'])
  })

  it('rejoins to the original text', () => {
    for (const name of ['makeSearchFsaKnowledgeTool', 'a.b.c', 'X', 'URLs2Fetch']) expect(wordParts(name).join('')).toBe(name)
  })
})
