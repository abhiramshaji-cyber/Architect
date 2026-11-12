import { useEffect, useMemo, useState } from 'react'
import type { Churn } from '../../../shared/recency'
import type { Ownership } from '../../../shared/types'
import { useProject } from '../../model/store'
import { useFunctions } from '../functions/useFunctions'
import { type MapNode, nest } from './layout/nest'
import { gather } from './modes/gather'
import type { Facts } from './modes/shade'

export type MapData = {
  tree: MapNode | null
  facts: Facts | null
  error: string | null
  churnError: string | null
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
const askOwners = (root: string): Promise<Ownership | null> => window.architect.ownership(root)

export function useMap(): MapData {
  const { currentRoot, codeMap, architecture, history } = useProject()
  const { list, error } = useFunctions(currentRoot, codeMap, '')
  const churn = useAsked(currentRoot, codeMap !== undefined, askChurn, codeMap)
  const owners = useAsked(currentRoot, list !== null, askOwners, list, architecture)
  const settled = architecture === null || owners.answered
  const project = currentRoot?.split(/[\\/]/).filter(Boolean).pop() ?? ''

  const tree = useMemo(
    () => (list && settled ? nest(list.rows, architecture ? owners.value : null, project) : null),
    [list, settled, architecture, owners.value, project],
  )
  const facts = useMemo(() => (list ? gather(list, churn.value, history) : null), [list, churn.value, history])

  return {
    tree,
    facts,
    error,
    churnError: churn.error,
    grouped: architecture && owners.value ? 'components' : 'folders',
  }
}
