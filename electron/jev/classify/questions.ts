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
    ...(responsibility ? { responsibility } : {}),
  }
  const version = createHash('sha256').update(JSON.stringify([JEV_MODEL, questions])).digest('hex').slice(0, 16)
  return { version, questions }
}
