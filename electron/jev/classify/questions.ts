import { createHash } from 'node:crypto'
import { JEV_MODEL, type ChoiceQuestion } from '../client'

export const BEHAVIORS: Record<string, string> = {
  parse: 'reads values out of text or bytes',
  validate: 'checks a value against rules',
  compute: 'derives a value, no side effects',
  query: 'reads stored or cached data',
  persist: 'writes or deletes stored data',
  external: 'calls a process, network or OS',
  present: 'builds UI, messages or reports',
  serialize: 'encodes values for storage or transport',
  coordinate: 'runs other functions for a larger task',
  respond: 'handles an incoming event or request',
  track: 'holds or announces shared state',
  setup: 'creates or configures resources',
}

export const INPUTS: Record<string, string> = {
  nothing: 'no arguments used',
  text: 'a string',
  path: 'a file path or URL',
  number: 'a number, size or time',
  record: 'one object or options',
  collection: 'a list, map or set',
  error: 'an error or failure',
  event: 'an event or request payload',
  resource: 'a live handle: process, socket, client',
}

export const OUTPUTS: Record<string, string> = {
  nothing: 'nothing used, side effects only',
  text: 'a string',
  number: 'a number, size or time',
  verdict: 'yes or no, or problems found',
  record: 'one object',
  collection: 'a list, map or set',
  view: 'UI markup or a drawing',
  resource: 'a live handle: process, server, client',
}

export const EFFECTS: Record<string, string> = {
  none: 'nothing outside its result',
  files: 'files on disk',
  network: 'the network',
  process: 'other processes or the OS',
  screen: 'what is on screen',
  memory: 'lasting in-memory state',
  log: 'logs or metrics',
}

export const BEHAVIOR_QUESTIONS = ['behavior', 'input', 'output', 'effect'] as const

export type QuestionSet = { version: string; questions: Record<string, ChoiceQuestion> }

const choice = (instructions: string, criteria: Record<string, string>): ChoiceQuestion => ({ type: 'choice', instructions, criteria })

const questions: Record<string, ChoiceQuestion> = {
  behavior: choice('Main job of this function, judged by its body and calls?', BEHAVIORS),
  input: choice('Kind of value it mainly works on, judged by how the body uses it?', INPUTS),
  output: choice('Kind of value it returns?', OUTPUTS),
  effect: choice('What it changes outside its return value, directly or via calls?', EFFECTS),
}

export const QUESTIONS: QuestionSet = { version: createHash('sha256').update(JSON.stringify([JEV_MODEL, questions])).digest('hex').slice(0, 16), questions }
