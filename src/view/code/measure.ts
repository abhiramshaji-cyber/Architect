import { useCallback, useState } from 'react'
import type { Node, NodeChange } from '@xyflow/react'
import type { CodeNode, CodeNodeData } from '../../model/codemap'

export function useMeasured() {
  const [measured, setMeasured] = useState<Map<string, number>>(() => new Map())

  const sized = useCallback(
    (logical: CodeNode[]) => logical.map((n) => ({ ...n, height: measured.get(n.id) ?? n.height })),
    [measured]
  )

  const onNodesChange = useCallback((changes: NodeChange<Node<CodeNodeData>>[]) => {
    const sizes = changes.flatMap((c) => (c.type === 'dimensions' && c.dimensions ? [[c.id, c.dimensions.height] as const] : []))
    if (sizes.length === 0) return
    setMeasured((prev) => (sizes.every(([id, height]) => prev.get(id) === height) ? prev : new Map([...prev, ...sizes])))
  }, [])

  return { measured, sized, onNodesChange }
}
