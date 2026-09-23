import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { provideCommands, revokeCommands, type Command } from '../shell/commands'
import CommandPalette from './CommandPalette'

const token = {}

const commands: Command[] = [
  { id: 'pane.split.right', label: 'Split right', keys: ['KeyP', 'KeyV'], run: () => {} },
  { id: 'code.jump', label: 'Jump to definition', keys: ['KeyG'], scope: 'code', run: () => {} },
  { id: 'pane.close', label: 'Close pane', keys: ['KeyP', 'KeyQ'], enabled: false, run: () => {} },
  { id: 'palette.open', label: 'Command palette', run: () => {} },
]

function markup(scope: string): string {
  provideCommands(token, commands)
  return renderToStaticMarkup(<CommandPalette scope={scope} onClose={() => {}} />)
}

function row(html: string, label: string): string {
  const at = html.indexOf(label)
  return html.slice(html.lastIndexOf('<li', at), at)
}

afterEach(() => revokeCommands(token))

describe('CommandPalette', () => {
  it('lists every registered command', () => {
    const html = markup('contract')
    for (const command of commands) expect(html).toContain(command.label)
  })

  it('shows the bound chord beside a command that has one', () => {
    expect(markup('contract')).toContain('space p v')
  })

  it('shows no chord for a command that has none', () => {
    const html = markup('contract')
    expect(html.match(/palette-chord/g)).toHaveLength(commands.length - 1)
  })

  it('shows a command that is out of the current scope as disabled, not hidden', () => {
    const html = markup('contract')
    expect(html).toContain('Jump to definition')
    expect(row(html, 'Jump to definition')).toContain('aria-disabled="true"')
  })

  it('enables that same command once its scope is focused', () => {
    expect(row(markup('code'), 'Jump to definition')).toContain('aria-disabled="false"')
  })

  it('shows a command that declares itself unavailable as disabled', () => {
    expect(row(markup('contract'), 'Close pane')).toContain('aria-disabled="true"')
  })

  it('selects a runnable command first, never a disabled one', () => {
    const html = markup('contract')
    const selected = html.match(/class="palette-item selected[^"]*"/)?.[0] ?? ''
    expect(selected).not.toContain('disabled')
  })
})
