/**
 * Typed edge. Style comes from the edge family (graph.css): structure thin,
 * reuse medium, safety path in ink, writes short-dashed, influence dotted.
 * A changed relationship is heavier, long-dashed and carries a diamond at its
 * midpoint, so it reads without colour. When an impact trace passes along the
 * edge an ink overlay is drawn over it once, delayed by its hop count.
 */
import { memo } from 'react'
import type { CSSProperties } from 'react'
import { getBezierPath } from '@xyflow/react'
import type { Edge, EdgeProps } from '@xyflow/react'
import type { GraphEdge } from '@interlock/core/types'
import { cx } from '../../lib/cx.ts'
import { EDGE_FAMILY } from './graphModel.ts'

export interface IlEdgeData extends Record<string, unknown> {
  edge: GraphEdge
  dim: boolean
  hl: boolean
  revealDelay: number
  /** Hop at which an active trace crosses this edge, or -1. */
  hop: number
  traceKey: number
  hopMs: number
}

export type IlFlowEdge = Edge<IlEdgeData, 'il'>

function IlEdgeImpl({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<IlFlowEdge>) {
  if (!data) return null
  const { edge, dim, hl, revealDelay, hop, traceKey, hopMs } = data
  const [path, midX, midY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.3 })
  const family = EDGE_FAMILY[edge.type]
  const solid = !edge.changed && (family === 'structure' || family === 'reuse' || family === 'safety')
  const marker = family === 'influence' ? undefined : edge.changed ? 'url(#il-arrow-changed)' : family === 'safety' || hl ? 'url(#il-arrow-strong)' : 'url(#il-arrow)'
  const style = { '--il-reveal': `${revealDelay}ms` } as CSSProperties

  return (
    <g>
      <path
        d={path}
        pathLength={solid ? 1 : undefined}
        markerEnd={marker}
        style={style}
        className={cx('il-e', `il-e--${family}`, solid && 'is-draw', edge.changed && 'is-changed', dim && 'is-dim', hl && 'is-hl')}
      />
      {edge.changed && <rect x={midX - 4} y={midY - 4} width={8} height={8} transform={`rotate(45 ${midX} ${midY})`} style={style} className={cx('il-e-mid', dim && 'is-dim')} />}
      {hop > 0 && (
        <path
          key={traceKey}
          d={path}
          pathLength={1}
          markerEnd="url(#il-arrow-strong)"
          style={{ '--il-hop': `${(hop - 1) * hopMs}ms` } as CSSProperties}
          className="il-e-trace"
        />
      )}
    </g>
  )
}

export const IlEdge = memo(IlEdgeImpl)

export const edgeTypes = { il: IlEdge }

/** Arrowheads referenced by url(#…); rendered once next to the canvas. */
export function EdgeMarkers() {
  const marker = (id: string, cls: string) => (
    <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
      <path d="M0 1.2 9 5 0 8.8z" className={cls} />
    </marker>
  )
  return (
    <svg aria-hidden="true" width="0" height="0" className="absolute">
      <defs>
        {marker('il-arrow', 'il-arrow')}
        {marker('il-arrow-strong', 'il-arrow-strong')}
        {marker('il-arrow-changed', 'il-arrow-changed')}
      </defs>
    </svg>
  )
}
