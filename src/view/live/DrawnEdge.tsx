import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'

export default function DrawnEdge({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  style,
  label
}: EdgeProps) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return (
    <BaseEdge
      path={path}
      markerEnd={markerEnd}
      style={style}
      pathLength={1}
      label={label}
      labelX={labelX}
      labelY={labelY}
      labelShowBg
      labelBgPadding={[4, 2]}
      labelBgBorderRadius={3}
      labelStyle={{ fontSize: 11, fill: 'var(--text-dim)' }}
      labelBgStyle={{ fill: 'var(--bg)' }}
    />
  )
}

export const edgeTypes = { drawn: DrawnEdge }
