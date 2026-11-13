import type { Architecture, Component, DraftResult, Edge, Ownership } from '../../shared/types'
import { type AiRun, failureOf } from '../ai'
import { reply, scrub } from './message'

const TIMEOUT_MS = 3 * 60 * 1000
const MAX_TURNS = 8
const MAX_TEXT = 2000

export type Turn = { asker: boolean; text: string }

export type Answer = { text: string; view: unknown }

const RULES = [
  "You answer questions about one project's architecture diagram. The diagram is drawn from its architect.md, given below as <contract>.",
  '',
  'Ground every statement in <contract>. When something is not in it, say the diagram does not show it. Never guess at code, files or behaviour the contract does not list.',
  'An edge {"from": "a", "to": "b"} means a calls or depends on b. To say how something reaches a component, walk the edges in order and quote their labels.',
  "A component's kind is external when it owns no files, entry when nothing depends on it, foundation when it depends on nothing, middle otherwise.",
  'You cannot change architect.md. If asked to add, remove, rename or redraw a component or an edge, say that is done through a proposed change or an edit on the Contract page, and change nothing.',
  '',
  'You can change how the diagram is shown, only for this person, through the view field. Every field is optional:',
  '- layout: "top-down" or "left-right"',
  '- spacing: "compact", "normal" or "roomy"',
  '- labels: false hides edge labels, true shows them',
  '- externals: false hides every external component, true shows them',
  '- group: true lays components out in bands by kind, false goes back to the normal layout',
  '- hide: component ids to hide; it replaces the hidden list, so repeat any already hidden that should stay hidden, and [] shows them all',
  '- focus: {"components": [ids], "depth": 0 to 3 (neighbours to include, 1 when left out), "rest": "dim" or "hide"} highlights those components and their neighbours; null clears it',
  '- path: {"from": id, "to": id} highlights the path along the edges from one to the other; null clears it',
  '- reset: true goes back to the default view before applying the other fields',
  '',
  'Reply with one JSON object and nothing else, no prose around it and no markdown fence:',
  '{"reply": "...", "view": null}',
  '',
  '- reply is short plain prose for the person, and says what you changed in the view when you changed it',
  '- view is null unless the person asked to change what they see',
  '- use component ids exactly as written in <contract>',
  '- Run no commands. Everything you need is below.',
].join('\n')

function kindOf(component: Component, edges: Edge[]): string {
  if (component.owns.length === 0) return 'external'
  if (!edges.some((e) => e.to === component.id)) return 'entry'
  if (!edges.some((e) => e.from === component.id)) return 'foundation'
  return 'middle'
}

export function contractOf(architecture: Architecture, ownership: Ownership | null): string {
  const files = new Map<string, number>()
  for (const { owner } of ownership?.owned ?? []) files.set(owner, (files.get(owner) ?? 0) + 1)

  return JSON.stringify({
    title: architecture.title,
    summary: architecture.summary,
    components: architecture.components.map((c) => ({
      id: c.id,
      kind: kindOf(c, architecture.edges),
      purpose: c.purpose,
      owns: c.owns,
      ...(ownership && { files: files.get(c.id) ?? 0 }),
    })),
    edges: architecture.edges,
    forbidden: architecture.forbidden,
    ...(ownership && {
      ownership: { owned: ownership.owned.length, unowned: ownership.unowned.length, multiOwned: ownership.multi.length, deadGlobs: ownership.dead.length },
    }),
  })
}

function turnsOf(turns: unknown): Turn[] {
  if (!Array.isArray(turns)) return []
  return turns
    .filter((t): t is Turn => typeof t === 'object' && t !== null && typeof t.text === 'string')
    .slice(-MAX_TURNS)
    .map((t) => ({ asker: t.asker === true, text: t.text.slice(0, MAX_TEXT) }))
}

export async function askContract(
  root: string,
  architecture: Architecture | null,
  ownership: Ownership | null,
  question: unknown,
  turns: unknown,
  view: unknown,
  run: AiRun,
): Promise<DraftResult<Answer>> {
  const asked = typeof question === 'string' ? question.trim().slice(0, MAX_TEXT) : ''
  if (asked === '' || !architecture) return { ok: false, error: { kind: 'nothing-to-draft' } }

  const said = turnsOf(turns).map((t) => (t.asker ? `<person>\n${t.text}\n</person>` : `<you>\n${t.text}\n</you>`))

  const prompt = [
    RULES,
    '',
    `<contract>\n${contractOf(architecture, ownership)}\n</contract>`,
    `<current-view>\n${JSON.stringify(view ?? null)}\n</current-view>`,
    `<conversation>\n${said.join('\n')}\n</conversation>`,
    `<question>\n${asked}\n</question>`,
  ].join('\n')

  const out = await run(prompt, root, TIMEOUT_MS)
  const failed = failureOf(out)
  if (failed) return { ok: false, error: failed }

  const row = reply(out.stdout)
  const text = row && typeof row.reply === 'string' ? scrub(row.reply) : ''
  if (!row || text === '') return { ok: false, error: { kind: 'unusable', detail: 'the reply was not the JSON object that was asked for' } }

  return { ok: true, value: { text, view: row.view ?? null } }
}
