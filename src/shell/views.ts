import type { ComponentType } from 'react'
import CodeView from '../view/CodeView'
import ContractView from '../view/ContractView'

export type ViewId = 'contract' | 'code'
export type ViewProps = { theme: string }

export const views: Record<ViewId, { label: string; component: ComponentType<ViewProps> }> = {
  contract: { label: 'Contract', component: ContractView },
  code: { label: 'Code', component: CodeView },
}

export const VIEW_IDS = Object.keys(views) as ViewId[]
export const DEFAULT_VIEW: ViewId = 'contract'

export function isViewId(value: string): value is ViewId {
  return value in views
}
