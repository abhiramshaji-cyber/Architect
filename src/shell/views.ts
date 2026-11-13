import type { ComponentType } from 'react'
import AiView from '../view/ai/AiView'
import CodeView from '../view/CodeView'
import ContractView from '../view/ContractView'
import ConventionsView from '../view/conventions/ConventionsView'
import CouplingView from '../view/coupling/CouplingView'
import DiffView from '../view/diff'
import FilesView from '../view/FilesView'
import FlowView from '../view/flow/FlowView'
import LayersView from '../view/layers/LayersView'
import FunctionsView from '../view/functions/FunctionsView'
import MapView from '../view/map/MapView'
import HotspotsView from '../view/hotspots/HotspotsView'
import ReplayView from '../view/replay/ReplayView'
import RepoPicker from '../view/RepoPicker'
import ReviewView from '../view/review/ReviewView'
import TerminalView, { PlainShell } from '../view/TerminalView'

export type ViewId = 'ai' | 'functions' | 'map' | 'layers' | 'flow' | 'contract' | 'code' | 'diff' | 'review' | 'files' | 'hotspots' | 'coupling' | 'conventions' | 'replay' | 'terminal' | 'shell' | 'repos'
export type ViewProps = { theme: string; show: (view: ViewId) => void }

export const views: Record<ViewId, { label: string; component: ComponentType<ViewProps> }> = {
  functions: { label: 'Functions', component: FunctionsView },
  map: { label: 'Map', component: MapView },
  layers: { label: 'Layers', component: LayersView },
  flow: { label: 'Flow', component: FlowView },
  contract: { label: 'Contract', component: ContractView },
  code: { label: 'Code', component: CodeView },
  diff: { label: 'Diff', component: DiffView },
  review: { label: 'Review', component: ReviewView },
  files: { label: 'Files', component: FilesView },
  hotspots: { label: 'Hotspots', component: HotspotsView },
  coupling: { label: 'Coupling', component: CouplingView },
  conventions: { label: 'Conventions', component: ConventionsView },
  replay: { label: 'Replay', component: ReplayView },
  terminal: { label: 'Terminal', component: TerminalView },
  shell: { label: 'Shell', component: PlainShell },
  repos: { label: 'Repos', component: RepoPicker },
  ai: { label: 'AI', component: AiView },
}

export const VIEW_IDS = Object.keys(views) as ViewId[]
export const PROJECT_VIEWS = VIEW_IDS.filter((id) => id !== 'repos')
export const DEFAULT_VIEW: ViewId = 'functions'

export function isViewId(value: string): value is ViewId {
  return value in views
}

export function shownView(view: ViewId, rooted: boolean): ViewId {
  if (!rooted) return 'repos'
  return view === 'repos' ? DEFAULT_VIEW : view
}
