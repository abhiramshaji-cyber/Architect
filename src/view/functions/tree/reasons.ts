import type { EntryReason } from '../../../../shared/types'

export const REASON: Record<EntryReason, string> = {
  mcpTool: 'MCP tool',
  ipcHandler: 'IPC handler',
  bridge: 'Preload bridge',
  cliCommand: 'CLI command',
  electronMain: 'Electron main',
  preload: 'Electron preload',
  renderer: 'Electron renderer',
  page: 'Page script',
  bin: 'package.json bin',
  main: 'package.json main',
  script: 'package.json script',
}
