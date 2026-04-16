import type { EdgeProps } from '@xyflow/react'
import { memo } from 'react'

/**
 * Custom bezier edge that reads source/target positions from edge data
 * (injected by layoutMindmap), avoiding per-edge useNodes() subscription.
 */
export const MindmapEdge = memo(({
  data,
  style,
}: EdgeProps) => {
  const sourceX = (data?.sourceX as number) ?? 0
  const sourceY = (data?.sourceY as number) ?? 0
  const targetX = (data?.targetX as number) ?? 0
  const targetY = (data?.targetY as number) ?? 0

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
