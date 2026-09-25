import type { ComponentType } from 'react'
import CodeView from '../view/CodeView'
import ContractView from '../view/ContractView'
import DiffView from '../view/DiffView'
import FilesView from '../view/FilesView'
import RepoPicker from '../view/RepoPicker'
import TerminalView, { PlainShell } from '../view/TerminalView'
import WorktreePicker from '../view/WorktreePicker'

export type ViewId = 'contract' | 'code' | 'diff' | 'files' | 'terminal' | 'shell' | 'repos' | 'worktrees'
export type ViewProps = { theme: string }

export const views: Record<ViewId, { label: string; component: ComponentType<ViewProps> }> = {
  contract: { label: 'Contract', component: ContractView },
  code: { label: 'Code', component: CodeView },
  diff: { label: 'Diff', component: DiffView },
  files: { label: 'Files', component: FilesView },
  terminal: { label: 'Terminal', component: TerminalView },
  shell: { label: 'Shell', component: PlainShell },
  repos: { label: 'Repos', component: RepoPicker },
  worktrees: { label: 'Worktrees', component: WorktreePicker },
}

export const VIEW_IDS = Object.keys(views) as ViewId[]
export const DEFAULT_VIEW: ViewId = 'contract'

export function isViewId(value: string): value is ViewId {
  return value in views
}
