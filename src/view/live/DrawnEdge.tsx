import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'

export default function DrawnEdge({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, markerEnd, style }: EdgeProps) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return <BaseEdge path={path} markerEnd={markerEnd} style={style} pathLength={1} />
}

export const edgeTypes = { drawn: DrawnEdge }
