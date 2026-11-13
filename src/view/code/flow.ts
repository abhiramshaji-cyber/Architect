import type { Node } from '@xyflow/react'
import { widthOf, type CodeNode, type CodeNodeData } from '../../model/codemap'

export function toFlow(logical: CodeNode[], at: Map<string, { x: number; y: number }>): Node<CodeNodeData>[] {
  return logical.map((n) => ({
    id: n.id,
    type: n.data.kind,
    draggable: false,
    deletable: false,
    position: at.get(n.id) ?? { x: 0, y: 0 },
    style: { width: widthOf(n.data) },
    data: n.data
  }))
}
