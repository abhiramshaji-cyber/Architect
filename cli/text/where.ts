import type { Where } from '../../electron/where'
import { plural } from '../../shared/text/plural'

const pad = (label: string) => `  ${label.padEnd(10)} `
const indent = (lines: string[]) => lines.map((line) => `${' '.repeat(13)}${line}`)

function refLines(where: Where): string[] {
  return [...where.calls.map((ref) => ({ side: 'calls', ref })), ...where.callers.map((ref) => ({ side: 'caller', ref }))].map(
    ({ side, ref }) => `${pad(side)}${ref.ref}  ${ref.status}${ref.matches.length > 0 ? `  ${ref.matches.join(', ')}` : ''}`,
  )
}

function newFileLine(where: Where): string[] {
  const probe = where.folder.newFile
  if (!probe) return []
  if (probe.error) return indent([`new file: could not check, ${probe.error}`])
  if (probe.fits) return indent(['new file: fits the files rule'])
  return indent([`new file: would break ${probe.violations.map((v) => `${v.rule} (${v.message})`).join('; ')}, add it to an existing file here`])
}

function fileLines(where: Where): string[] {
  const file = where.file
  if (!file) return []
  const owners = file.owners.length > 0 ? `owned by ${file.owners.join(', ')}` : 'owned by no component'
  const verdict = file.error ? `could not check, ${file.error}` : file.fits ? 'breaks no rule' : `breaks ${plural(file.violations.length, 'rule')}`
  const broken = file.violations.map((v) => `${v.rule} ${v.path}${v.line === undefined ? '' : `:${v.line}`} ${v.message}`)
  return [`${pad('file')}${file.file}  ${owners}, ${verdict}`, ...indent(broken)]
}

export function whereText(where: Where): string {
  const { component, folder, verb, similar } = where
  const proposed = verb.proposed
  return [
    `architect: where for ${plural(where.calls.length, 'call')} and ${plural(where.callers.length, 'caller')}`,
    ...refLines(where),
    `${pad('component')}${component.id ?? `(${component.status})`}  ${component.reason}`,
    ...indent(component.candidates.flatMap((c) => [`${c.component}  ${plural(c.neighbours, 'neighbour')}`, ...c.blocked.map((b) => `  needs ${b.from} -> ${b.to}, ${b.verdict}, for ${b.ref}`)])),
    `${pad('folder')}${folder.path ?? `(${folder.status})`}  ${folder.reason}`,
    ...newFileLine(where),
    `${pad('verb')}${verb.verb ?? `(${verb.status})`}  ${verb.reason}`,
    ...(proposed ? indent([`${proposed.name} starts with ${proposed.word ?? 'no word'}, which leads ${plural(proposed.count, 'name')} there`]) : []),
    `${pad('similar')}${similar.status === 'found' ? similar.matches[0]?.name : `(${similar.status})`}  ${similar.reason}`,
    ...indent(similar.matches.flatMap((m) => [`${m.at} ${m.name}`, ...m.callees.map((c) => `  calls ${c}`), ...m.callers.map((c) => `  called by ${c}`)])),
    ...fileLines(where),
    ...where.notes.map((note) => `${pad('note')}${note}`),
  ].join('\n')
}
