import { createHash } from 'node:crypto'
import type { Architecture } from '../../../shared/types'
import { JEV_MODEL, LIMITS, type ChoiceQuestion } from '../client'

export const BEHAVIORS: Record<string, string> = {
  parse: 'Reads structured values out of text, bytes or another format.',
  validate: 'Checks a value against rules and accepts, rejects or reports on it.',
  compute: 'Derives a new value from its inputs without touching anything outside.',
  query: 'Looks up or reads data held in a store, cache, file, index or collection.',
  persist: 'Writes, updates or deletes stored data or files.',
  external: 'Talks to another process, a network service, the operating system or a device.',
  present: 'Builds what a person sees or reads: user interface, messages or reports.',
  serialize: 'Turns values into a format meant for storage, transport or another program.',
  coordinate: 'Runs other functions in order to carry out a larger task.',
  respond: 'Reacts to an event, request, message or callback coming from outside.',
  track: 'Holds, updates or announces in-memory state that other code reads.',
  setup: 'Creates, wires or configures resources, settings or dependencies before use.',
}

export const INPUTS: Record<string, string> = {
  nothing: 'Takes no arguments, or ignores the ones it is given.',
  text: 'A string: free text, a name, an identifier or a line of output.',
  path: 'A file or folder path, a URL or another address of something to open.',
  number: 'A number, count, size, ratio, index or time.',
  record: 'One structured object, options bag, entity or configuration.',
  collection: 'A list, map, set, stream or table of many items.',
  error: 'An error, a thrown value of unknown type, or a failure result.',
  event: 'An event, request, message or callback payload delivered from outside.',
  resource: 'A live handle: a process, socket, database, element, window or client.',
}

export const OUTPUTS: Record<string, string> = {
  nothing: 'Returns nothing a caller uses; its work is its side effects.',
  text: 'A string meant for a person or for another program to read.',
  number: 'A number, count, size, ratio, index or time.',
  verdict: 'A yes or no, a pass or fail, or a list of problems found.',
  record: 'One structured object or entity.',
  collection: 'A list, map, set or table of many items.',
  view: 'Interface markup, a component tree or something drawn on screen.',
  resource: 'A live handle: a process, socket, server, connection, client or subscription.',
}

export const EFFECTS: Record<string, string> = {
  none: 'Touches nothing outside its own return value.',
  files: 'Reads or writes files or folders on disk.',
  network: 'Sends or receives over the network.',
  process: 'Starts, signals or talks to another process or the operating system.',
  screen: 'Changes what is shown on screen or in the document.',
  memory: 'Changes in-memory state that outlives the call: caches, stores, listeners.',
  log: 'Writes logs, metrics or diagnostics.',
}

export const BEHAVIOR_QUESTIONS = ['behavior', 'input', 'output', 'effect'] as const

export type QuestionSet = { version: string; questions: Record<string, ChoiceQuestion> }

function clipped(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`
}

function responsibilityOf(architecture: Architecture | null): ChoiceQuestion | null {
  const criteria: Record<string, string> = {}
  for (const component of architecture?.components ?? []) {
    const label = clipped(component.id, LIMITS.label)
    if (label !== '' && !(label in criteria)) criteria[label] = clipped(component.purpose || component.id, LIMITS.description)
  }
  const count = Object.keys(criteria).length
  if (count < 2 || count > LIMITS.choices) return null
  return {
    type: 'choice',
    instructions: 'Which part of this project, as its own architecture describes them, does this function do the work of? Judge by what the code does, not by the folder it sits in.',
    criteria,
  }
}

export function questionsOf(architecture: Architecture | null): QuestionSet {
  const responsibility = responsibilityOf(architecture)
  const questions: Record<string, ChoiceQuestion> = {
    behavior: {
      type: 'choice',
      instructions: 'What is the main thing this function does with its inputs? Judge by its body, its signature and the functions it calls.',
      criteria: BEHAVIORS,
    },
    input: {
      type: 'choice',
      instructions: 'What kind of value does this function mainly work on? Judge by how the body uses its parameters, not by their names.',
      criteria: INPUTS,
    },
    output: {
      type: 'choice',
      instructions: 'What kind of value does this function hand back to its caller? Judge by what the body returns or resolves to.',
      criteria: OUTPUTS,
    },
    effect: {
      type: 'choice',
      instructions: 'What does this function change outside its return value, directly or through the functions it calls?',
      criteria: EFFECTS,
    },
    ...(responsibility ? { responsibility } : {}),
  }
  const version = createHash('sha256').update(JSON.stringify([JEV_MODEL, questions])).digest('hex').slice(0, 16)
  return { version, questions }
}
