import type { EdgeProps } from '@xyflow/react'
import { useNodes } from '@xyflow/react'
import { memo } from 'react'

const NODE_WIDTH = 360

/**
 * Custom bezier edge that calculates path from node positions directly,
 * bypassing xyflow's handle-based path calculation which requires DOM measurement.
 */
export const MindmapEdge = memo(({
  source,
  target,
  style,
}: EdgeProps) => {
  const nodes = useNodes()
  const sourceNode = nodes.find(n => n.id === source)
  const targetNode = nodes.find(n => n.id === target)

  if (!sourceNode || !targetNode) return null

  const sourceX = sourceNode.position.x + NODE_WIDTH
  const sourceY = sourceNode.position.y + (sourceNode.measured?.height ?? 80) / 2
  const targetX = targetNode.position.x
  const targetY = targetNode.position.y + (targetNode.measured?.height ?? 80) / 2

  // Horizontal distance for control points (creates a smooth S-curve)
  const controlOffset = Math.min(Math.abs(targetX - sourceX) * 0.4, 80)

  const path = `M ${sourceX} ${sourceY} C ${sourceX + controlOffset} ${sourceY}, ${targetX - controlOffset} ${targetY}, ${targetX} ${targetY}`

  return (
    <path
      d={path}
      fill="none"
      stroke={style?.stroke ?? 'hsl(var(--muted-foreground))'}
      strokeWidth={style?.strokeWidth ?? 1.5}
      className="react-flow__edge-path"
    />
  )
})
