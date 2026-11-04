import type { Evidence } from './evidence'

const MAX_QUIET = 40

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function promptFor(found: Evidence, title: string, scope = '', feedback = ''): string {
  const functions = found.functions.map(({ ref, row }) =>
    [ref, row.file, row.name, row.importance, row.fanIn, row.entry ? 'entry' : '-', oneLine(row.summary)].join(' | '),
  )

  const callees = new Map<number, number[]>()
  for (const [from, to] of found.calls) callees.set(from, [...(callees.get(from) ?? []), to])
  const calls = [...callees].map(
    ([from, to]) => `${found.functions[from]?.ref} -> ${to.map((at) => found.functions[at]?.ref).join(', ')}`,
  )

  const quiet = found.files.filter((file) => !found.indexed.has(file)).slice(0, MAX_QUIET)

  return [
    ...(feedback === '' ? [] : [feedback, '']),
    scope === ''
      ? `Draw the project "${title}" as an architecture flow chart.`
      : `Draw the project "${title}" at ${scope}/ as an architecture flow chart. The rest of the repo is out of scope.`,
    '',
    'A flow chart here shows the runtime components of the project and how a request or data moves between them.',
    'A component is one runtime responsibility: where input arrives, the code that decides what to do with it, a model or agent loop, a tool, retrieval, a store, a background job, or an outside service the code talks to.',
    'A component is never a folder. Test, script, build and documentation code is not a runtime component.',
    '',
    'Architect indexed every function without AI. Each line is: ref | file | name | importance 1 to 5 | used in N places | entry point or - | what it does.',
    '<functions>',
    ...functions,
    '</functions>',
    '',
    'Calls between those functions, caller -> callees:',
    '<calls>',
    ...(calls.length > 0 ? calls : ['none']),
    '</calls>',
    '',
    'Files with no functions, such as config, data and docs:',
    ...(quiet.length > 0 ? quiet.map((file) => `- ${file}`) : ['- none']),
    '',
    'Rules:',
    '- Group the functions into components by what they do at runtime, not by the folder they sit in. Put each function in at most one component and leave out test, build and tooling functions.',
    '- Add a component with an empty functions list for each outside service the code plainly talks to, such as a model provider, a database, a knowledge base or an external API.',
    '- Write flows in the direction a request or data moves. Draw a flow for every pair of components the calls connect and for every outside service a component uses. Label each flow with what moves along it, in a few words.',
    '- Flows must not form a loop. For a call that returns a result, draw only the call direction.',
    '- Ids are lowercase words joined by hyphens.',
    '',
    'Reply with only this JSON and nothing else:',
    '{"title": "<project name>", "summary": "<one sentence saying what the project does>", "components": [{"id": "<id>", "purpose": "<one sentence>", "functions": ["<ref>"]}], "flows": [{"from": "<id>", "to": "<id>", "label": "<what moves>"}]}',
  ].join('\n')
}
