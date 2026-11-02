import { describe, expect, it } from 'vitest'
import type { FunctionEntry, FunctionFacts } from '../../shared/types'
import { sentenceOf } from './sentence'
import { wordsOf } from './verbs'

const said = (name: string, over: Partial<FunctionEntry> = {}, facts: Partial<FunctionFacts> = {}) =>
  sentenceOf(
    { name, line: 1, endLine: 1, description: '', calls: [], ...over },
    { file: 'src/a.ts', name, line: 1, lines: 1, fanIn: 0, fanOut: 0, exported: false, entry: false, ...facts },
  )

describe('wordsOf', () => {
  it('splits camel, pascal, snake and kebab case', () => {
    expect(wordsOf('fnKey')).toEqual(['fn', 'key'])
    expect(wordsOf('FunctionsView')).toEqual(['functions', 'view'])
    expect(wordsOf('load_user_data')).toEqual(['load', 'user', 'data'])
    expect(wordsOf('MAX_SIZE')).toEqual(['MAX', 'SIZE'])
  })

  it('keeps acronyms whole and digits apart', () => {
    expect(wordsOf('parseURL')).toEqual(['parse', 'URL'])
    expect(wordsOf('HTTPServer')).toEqual(['HTTP', 'server'])
    expect(wordsOf('toJSONString')).toEqual(['to', 'JSON', 'string'])
    expect(wordsOf('base64Encode')).toEqual(['base', '64', 'encode'])
    expect(wordsOf('')).toEqual([])
  })
})

describe('sentenceOf', () => {
  it('prefers the comment the author wrote', () => {
    expect(said('fnKey', { doc: 'Builds a lookup key.' })).toBe('Builds a lookup key.')
  })

  it('describes each kind in plain words', () => {
    expect(said('Matchbook', { kind: 'component' })).toBe('Draws the matchbook piece on the page.')
    expect(said('useTheme')).toBe('Keeps track of the theme.')
    expect(said('handleSubmit')).toBe('Runs when submit happens.')
    expect(said('onFileOpen')).toBe('Runs when file open happens.')
    expect(said('Store.constructor', { kind: 'constructor' })).toBe('Sets up a new store.')
    expect(said('Store.size', { kind: 'getter' })).toBe('Gives back the size.')
    expect(said('Store.label', { kind: 'setter' })).toBe('Changes the label.')
    expect(said('Store.save', { kind: 'method' })).toBe('Saves it.')
    expect(said('rowCells', { kind: 'component' })).toBe('Draws the row cells on the page.')
  })

  it('names a default export after its file', () => {
    expect(said('default')).toBe('Does the main job of the a file.')
    expect(said('default', { kind: 'component' }, { file: 'src/HomePage.tsx' })).toBe(
      'Draws the home page piece on the page.',
    )
  })

  it('reads a leading verb from the verb map', () => {
    expect(said('fnKey')).toBe('Works out the fn key.')
    expect(said('getUser')).toBe('Gets the user.')
    expect(said('setTheme')).toBe('Sets the theme.')
    expect(said('isEmpty')).toBe('Tells whether it is empty.')
    expect(said('hasChanges')).toBe('Tells whether it has changes.')
    expect(said('loadConfig')).toBe('Loads the config.')
    expect(said('saveDraft')).toBe('Saves the draft.')
    expect(said('parseURL')).toBe('Reads the URL and makes sense of it.')
    expect(said('buildIndex')).toBe('Puts together the index.')
    expect(said('build')).toBe('Puts it together.')
    expect(said('renderRow')).toBe('Draws the row.')
    expect(said('fetchRepos')).toBe('Fetches the repos.')
    expect(said('createUser')).toBe('Makes a new user.')
    expect(said('deleteEdit')).toBe('Deletes the edit.')
    expect(said('updateRow')).toBe('Updates the row.')
    expect(said('formatDate')).toBe('Formats the date.')
    expect(said('checkAccess')).toBe('Checks the access.')
    expect(said('copyFiles')).toBe('Copies the files.')
    expect(said('sortByName')).toBe('Sorts by name.')
    expect(said('toString')).toBe('Turns it into string.')
    expect(said('constructor')).toBe('Works out the constructor.')
  })

  it('adds who uses it', () => {
    expect(said('fnKey', {}, { fanIn: 12 })).toBe('Works out the fn key. Used in 12 places.')
    expect(said('fnKey', {}, { fanIn: 1 })).toBe('Works out the fn key. Used in 1 place.')
    expect(said('main', {}, { entry: true })).toBe('Works out the main. Starting point of the app.')
    expect(said('main', { doc: 'Boots everything.' }, { entry: true })).toBe(
      'Boots everything. Starting point of the app.',
    )
  })
})
