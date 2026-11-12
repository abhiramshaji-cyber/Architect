import { useEffect, useMemo, useState } from 'react'
import type { Churn } from '../../../shared/recency'
import type { CodeMap, FunctionList, StyleFile } from '../../../shared/types'
import { useProject } from '../../model/store'
import { type MapNode, nest } from './layout/nest'
import { gather } from './modes/gather'
import type { Facts } from './modes/shade'

export type MapData = {
  tree: MapNode | null
  facts: Facts | null
  error: string | null
  churnError: string | null
  styleError: string | null
  grouped: 'components' | 'folders'
}

type Asked<T> = { value: T | null; error: string | null; answered: boolean }

function useAsked<T>(
  root: string | null,
  ready: boolean,
  ask: (root: string) => Promise<T>,
  ...keys: unknown[]
): Asked<T> {
  const [found, setFound] = useState<(Asked<T> & { root: string }) | null>(null)

  useEffect(() => {
    if (!root || !ready) return
    let live = true
    ask(root).then(
      (value) => live && setFound({ root, value, error: null, answered: true }),
      (err: unknown) =>
        live &&
        setFound({ root, value: null, error: err instanceof Error ? err.message : String(err), answered: true }),
    )
    return () => {
      live = false
    }
  }, [root, ready, ...keys])

  return found?.root === root ? found : { value: null, error: null, answered: false }
}

const askChurn = (root: string): Promise<Churn> => window.architect.churn(root)
const askList = (root: string): Promise<FunctionList> => window.architect.listFunctions(root, '')
const askMap = (root: string): Promise<CodeMap | null> => window.architect.getCodeMap(root)
const askStyle = (root: string): Promise<StyleFile[]> => window.architect.style(root)

export function useMap(): MapData {
  const { currentRoot, codeMap, architecture, history } = useProject()
  const asked = useAsked(currentRoot, codeMap !== undefined, askList, codeMap, architecture)
  const list = asked.value
  const churn = useAsked(currentRoot, codeMap !== undefined, askChurn, codeMap)
  const style = useAsked(currentRoot, list !== null, askStyle, list)
  const scanned = useAsked(currentRoot, list !== null && codeMap === null, askMap, list)
  const project = currentRoot?.split(/[\\/]/).filter(Boolean).pop() ?? ''
  const map = codeMap ?? scanned.value
  const files = useMemo(() => map?.folders.flatMap((folder) => folder.files) ?? [], [map])

  const tree = useMemo(
    () => (list && map ? nest(list.rows, files, architecture ? list.owners : null, project) : null),
    [list, map, files, architecture, project],
  )
  const facts = useMemo(
    () => (list ? gather(list, churn.value, history, style.value) : null),
    [list, churn.value, history, style.value],
  )

  return {
    tree,
    facts,
    error:
      asked.error ??
      scanned.error ??
      (scanned.answered && !map ? 'The scan has no stored code map for this project.' : null),
    churnError: churn.error,
    styleError: style.error,
    grouped: architecture ? 'components' : 'folders',
  }
}
