/**
 * Custom React Flow nodes. One card component handles every GraphNodeType
 * with per-type styling:
 *   safety function  inverted (ink) card: the anchor of a protective path
 *   module           heavier card with a double hairline: one definition, many call sites
 *   tag              compact chip
 *   everything else  paper card with a type line, mono identifier and sublabel
 * Change state is a coloured left rail AND a glyph + word marker; severity is
 * the design-system glyph + word; undeclared logic gets a dashed border and
 * the word UNDECLARED. Text is keyed on its state so it remounts (headless
 * Chrome sometimes skips repainting text inside the transformed viewport).
 */
import { memo } from 'react'
import type { CSSProperties } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
import type { GraphNode, SafetyStatus } from '@interlock/core/types'
import { cx } from '../../lib/cx.ts'
import { Glyph, SEVERITY_META } from '../../ui/Badge.tsx'
import { enumLabel } from '../../lib/format.ts'
import { NODE_SIZE } from './layout.ts'
import { CHANGE_RAIL, ChangeMarker, TypeIcon } from './nodeVisual.tsx'
import { NODE_TYPE_LABEL } from './graphModel.ts'

export interface IlNodeData extends Record<string, unknown> {
  node: GraphNode
  sfStatus?: SafetyStatus
  selected: boolean
  reached: boolean
  reachDelay: number
  enterDelay: number
  emphUndeclared: boolean
}

export type IlFlowNode = Node<IlNodeData, 'il'>

const SEVERITY_FILL: Record<string, string> = {
  coral: 'fill-coral',
  marigold: 'fill-marigold',
  iris: 'fill-iris',
  neutral: 'fill-ink-2',
  outline: 'fill-ink',
}

const SF_STATUS: Record<SafetyStatus, { shape: 'octagon' | 'check' | 'square' | 'dash' | 'ring'; cls: string }> = {
  IMPACTED: { shape: 'octagon', cls: 'fill-coral text-coral' },
  STRENGTHENED: { shape: 'check', cls: 'text-sage' },
  CHANGED_EQUIVALENT: { shape: 'square', cls: 'fill-iris' },
  NO_CHANGE: { shape: 'dash', cls: 'fill-current opacity-70' },
  NOT_ANALYZED: { shape: 'ring', cls: 'text-current opacity-70' },
}

function SeverityMark({ node, inverted }: { node: GraphNode; inverted?: boolean }) {
  if (!node.severity) return null
  const m = SEVERITY_META[node.severity]
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-1 font-mono text-[0.625rem] font-semibold tracking-[0.06em]', inverted ? 'text-paper' : 'text-ink')}>
      <Glyph shape={m.shape} className={cx('size-2.5', SEVERITY_FILL[m.tone])} />
      {m.label}
    </span>
  )
}

function IlNodeImpl({ data }: NodeProps<IlFlowNode>) {
  const { node, sfStatus, selected, reached, reachDelay, enterDelay, emphUndeclared } = data
  const size = NODE_SIZE[node.type]
  const style = { width: size.width, height: size.height, '--il-enter': `${enterDelay}ms`, '--il-reach': `${reachDelay}ms` } as CSSProperties
  const stateKey = `${node.id}|${selected ? 's' : ''}${reached ? 'r' : ''}`
  const removed = node.change === 'removed'

  const handles = (
    <>
      <Handle type="target" position={Position.Left} className="il-handle" isConnectable={false} />
      <Handle type="source" position={Position.Right} className="il-handle" isConnectable={false} />
    </>
  )

  if (node.type === 'tag') {
    return (
      <div
        style={style}
        className={cx(
          'il-node relative flex items-center gap-2 overflow-hidden rounded-[11px] bg-surface pl-3 pr-2.5 shadow-inset-line',
          node.undeclared && 'shadow-none ring-0 [border:1px_dashed_rgb(var(--ink-3))]',
          selected && 'is-selected',
          reached && 'is-reached',
          emphUndeclared && 'is-emph-undeclared',
        )}
      >
        {handles}
        <span aria-hidden="true" className={cx('absolute inset-y-0 left-0 w-[3px]', CHANGE_RAIL[node.change])} />
        <TypeIcon type="tag" className="text-ink-3" />
        <span key={stateKey} className={cx('min-w-0 flex-1 truncate font-mono text-[0.75rem] font-medium text-ink', removed && 'line-through decoration-coral-ink')}>
          {node.label}
        </span>
        <ChangeMarker change={node.change} compact />
      </div>
    )
  }

  const isSf = node.type === 'safety-function'
  const isModule = node.type === 'module'
  const typeLine = NODE_TYPE_LABEL[node.type]

  return (
    <div
      style={style}
      className={cx(
        'il-node relative flex flex-col justify-center overflow-hidden rounded-[14px] py-2.5 pl-4 pr-3',
        isSf ? 'bg-ink text-paper shadow-lift' : 'bg-surface-raised text-ink shadow-soft ring-1 ring-inset ring-line',
        isModule && 'ring-2 ring-line-strong',
        node.undeclared && !isSf && 'shadow-none ring-0 [border:1.5px_dashed_rgb(var(--ink-3))]',
        removed && 'bg-paper-2 opacity-90',
        selected && 'is-selected',
        reached && 'is-reached',
        emphUndeclared && 'is-emph-undeclared',
      )}
    >
      {handles}
      <span aria-hidden="true" className={cx('absolute inset-y-0 left-0 w-1', CHANGE_RAIL[node.change])} />
      <div className="flex min-w-0 items-center gap-1.5">
        <TypeIcon type={node.type} className={isSf ? 'text-paper/80' : 'text-ink-2'} />
        <span className={cx('min-w-0 flex-1 truncate font-mono text-[0.625rem] font-medium uppercase tracking-[0.1em]', isSf ? 'text-paper/75' : 'text-ink-2')}>
          {typeLine}
          {node.undeclared && !isSf ? ' · undeclared' : node.safety && !isSf ? ' · safety' : ''}
        </span>
        <SeverityMark node={node} inverted={isSf} />
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-1.5">
        <span
          key={stateKey}
          className={cx('min-w-0 flex-1 truncate font-mono text-[0.8125rem] font-semibold leading-tight', isSf && 'font-sans text-[0.875rem] font-bold tracking-[-0.01em]', removed && 'line-through decoration-coral-ink')}
          title={node.label}
        >
          {node.label}
        </span>
        <ChangeMarker change={node.change} compact />
      </div>
      {(node.sublabel || sfStatus) && (
        <div className="mt-1 flex min-w-0 items-center gap-2">
          {node.sublabel && <span className={cx('min-w-0 flex-1 truncate font-mono text-[0.6875rem]', isSf ? 'text-paper/70' : 'text-ink-2')}>{node.sublabel}</span>}
          {isSf && sfStatus && (
            <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[0.625rem] font-semibold tracking-[0.06em] text-paper">
              <Glyph shape={SF_STATUS[sfStatus].shape} className={cx('size-2.5', SF_STATUS[sfStatus].cls)} />
              {sfStatus === 'CHANGED_EQUIVALENT' ? 'EQUIVALENT' : enumLabel(sfStatus)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export const IlNode = memo(IlNodeImpl)

export const nodeTypes = { il: IlNode }
