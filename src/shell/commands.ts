import { useEffect, useRef } from 'react'
import { score } from '../model/picker'
import { formatKey, type KeyBinding } from './chords'

export interface Command {
  id: string
  label: string
  run: () => void
  keys?: string[]
  scope?: string
  enabled?: boolean
}

const sources = new Map<object, Command[]>()

export function provideCommands(token: object, commands: Command[]): void {
  sources.set(token, commands)
}

export function revokeCommands(token: object): void {
  sources.delete(token)
}

export function listCommands(): Command[] {
  const byId = new Map<string, Command>()
  for (const command of [...sources.values()].flat()) byId.set(command.id, command)
  return [...byId.values()]
}

export function useCommands(commands: Command[]): void {
  const token = useRef({}).current

  useEffect(() => {
    provideCommands(token, commands)
  })

  useEffect(() => () => revokeCommands(token), [token])
}

export function commandBindings(commands: Command[]): KeyBinding[] {
  return commands.flatMap((command) =>
    command.keys && command.keys.length > 0 ? [{ command: command.id, keys: command.keys, scope: command.scope }] : []
  )
}

export function commandLabels(commands: Command[]): Record<string, string> {
  return Object.fromEntries(commands.map((command) => [command.id, command.label]))
}

export function isEnabled(command: Command, scope: string): boolean {
  return (command.scope === undefined || command.scope === scope) && command.enabled !== false
}

export function chordText(keys: string[], leader: string): string {
  return [leader, ...keys].map(formatKey).join(' ')
}

export function matchCommands(query: string, commands: Command[], scope: string): Command[] {
  return commands
    .flatMap((command) => {
      const hit = score(query, command.label)
      return hit === null ? [] : [{ command, hit, enabled: isEnabled(command, scope) }]
    })
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || b.hit - a.hit)
    .map((row) => row.command)
}

export function step(index: number, delta: number, count: number): number {
  if (count <= 0) return 0
  return (((index + delta) % count) + count) % count
}
