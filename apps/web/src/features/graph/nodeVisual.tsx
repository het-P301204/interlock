/**
 * Small visual vocabulary shared by the canvas nodes, the list view and the
 * inspector: a type icon, a change marker (glyph + word + colour, never colour
 * alone) and a safety/undeclared marker.
 */
import { Bell, Box, Boxes, Clock3, FolderTree, ListTree, Power, ShieldCheck, Tag } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { GraphNode, GraphNodeType, NodeChange } from '@interlock/core/types'
import { cx } from '../../lib/cx.ts'

export const TYPE_ICON: Record<GraphNodeType, LucideIcon> = {
  task: Clock3,
  program: FolderTree,
  routine: ListTree,
  module: Boxes,
  instance: Box,
  'safety-function': ShieldCheck,
  'protective-output': Power,
  alarm: Bell,
  tag: Tag,
}

export function TypeIcon({ type, className }: { type: GraphNodeType; className?: string }) {
  const Icon = TYPE_ICON[type]
  return <Icon aria-hidden="true" strokeWidth={1.75} className={cx('size-3.5 shrink-0', className)} />
}

const CHANGE_META: Record<Exclude<NodeChange, 'none'>, { glyph: string; word: string; cls: string }> = {
  added: { glyph: '+', word: 'ADDED', cls: 'bg-iris/[0.16] text-iris-ink ring-iris/45' },
  modified: { glyph: 'Δ', word: 'MODIFIED', cls: 'bg-marigold/[0.2] text-marigold-ink ring-marigold/50' },
  removed: { glyph: '−', word: 'REMOVED', cls: 'bg-coral/[0.14] text-coral-ink ring-coral/45' },
}

/** Rail colour on the left edge of a changed node. */
export const CHANGE_RAIL: Record<NodeChange, string> = {
  none: 'bg-transparent',
  added: 'bg-iris',
  modified: 'bg-marigold',
  removed: 'bg-coral',
}

export function ChangeMarker({ change, compact = false, className }: { change: NodeChange; compact?: boolean; className?: string }) {
  if (change === 'none') return null
  const m = CHANGE_META[change]
  return (
    <span
      className={cx(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-[6px] px-1.5 font-mono text-[0.625rem] font-semibold tracking-[0.06em] ring-1 ring-inset',
        m.cls,
        className,
      )}
    >
      <span aria-hidden="true" className="text-[0.75rem] leading-none">
        {m.glyph}
      </span>
      {compact ? <span className="sr-only">{m.word}</span> : m.word}
    </span>
  )
}

/** "SAFETY" for nodes inside a declared cone, "UNDECLARED" (dashed) for logic with no declared intent. */
export function ScopeMarker({ node, className }: { node: Pick<GraphNode, 'safety' | 'undeclared'>; className?: string }) {
  if (node.safety)
    return (
      <span className={cx('inline-flex h-5 shrink-0 items-center gap-1 rounded-[6px] bg-ink/[0.07] px-1.5 font-mono text-[0.625rem] font-semibold tracking-[0.06em] text-ink', className)}>
        <ShieldCheck aria-hidden="true" strokeWidth={2} className="size-3" />
        SAFETY
      </span>
    )
  if (node.undeclared)
    return (
      <span
        className={cx(
          'inline-flex h-5 shrink-0 items-center rounded-[6px] border border-dashed border-ink-3 px-1.5 font-mono text-[0.625rem] font-semibold tracking-[0.06em] text-ink-2',
          className,
        )}
      >
        UNDECLARED
      </span>
    )
  return null
}
