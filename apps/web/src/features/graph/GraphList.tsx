/**
 * List view: the same graph as an indented, keyboard-navigable tree. It is
 * the accessible alternative to the canvas and the default on phones.
 *
 * Keyboard (WAI-ARIA tree): ↑/↓ move, → expands or enters, ← collapses or
 * returns to the parent, Home/End jump, Enter/Space inspects the node,
 * * expands every sibling group. One row holds tabindex=0 (roving).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ChevronRight } from 'lucide-react'
import type { SafetyStatus } from '@interlock/core/types'
import { cx } from '../../lib/cx.ts'
import { Glyph, SEVERITY_META, StatusPill } from '../../ui/Badge.tsx'
import { NODE_TYPE_LABEL, buildTree } from './graphModel.ts'
import type { GraphIndex, Highlight, TreeGroup, TreeItem } from './graphModel.ts'
import { ChangeMarker, ScopeMarker, TypeIcon } from './nodeVisual.tsx'

interface Row {
  key: string
  level: number
  parent: string | null
  hasChildren: boolean
  group?: TreeGroup
  item?: TreeItem
  posinset: number
  setsize: number
}

export interface GraphListProps {
  index: GraphIndex
  visible: Set<string>
  selectedId: string | null
  highlight: Highlight | null
  sfStatus: Map<string, SafetyStatus>
  onSelect: (id: string) => void
}

function defaultExpanded(groups: TreeGroup[]): Set<string> {
  const s = new Set<string>()
  for (const g of groups) {
    s.add(`group:${g.id}`)
    if (g.id === 'execution' || g.id === 'modules') for (const it of g.items) s.add(it.key)
  }
  return s
}

/** Keys of every ancestor of the first row that shows `nodeId`. */
function pathTo(groups: TreeGroup[], nodeId: string): string[] | null {
  const walk = (items: TreeItem[], trail: string[]): string[] | null => {
    for (const it of items) {
      if (it.nodeId === nodeId) return trail
      const found = walk(it.children, [...trail, it.key])
      if (found) return found
    }
    return null
  }
  for (const g of groups) {
    const found = walk(g.items, [`group:${g.id}`])
    if (found) return found
  }
  return null
}

export function GraphList({ index, visible, selectedId, highlight, sfStatus, onSelect }: GraphListProps) {
  const groups = useMemo(() => buildTree(index, visible), [index, visible])
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(groups))
  const [active, setActive] = useState<string | null>(null)
  const refs = useRef(new Map<string, HTMLDivElement>())

  const rows = useMemo(() => {
    const out: Row[] = []
    groups.forEach((g, gi) => {
      const gk = `group:${g.id}`
      out.push({ key: gk, level: 1, parent: null, hasChildren: g.items.length > 0, group: g, posinset: gi + 1, setsize: groups.length })
      if (!expanded.has(gk)) return
      const add = (items: TreeItem[], level: number, parent: string) => {
        items.forEach((it, i) => {
          out.push({ key: it.key, level, parent, hasChildren: it.children.length > 0, item: it, posinset: i + 1, setsize: items.length })
          if (expanded.has(it.key)) add(it.children, level + 1, it.key)
        })
      }
      add(g.items, 2, gk)
    })
    return out
  }, [groups, expanded])

  // A selection made elsewhere (canvas, deep link) opens the tree down to its first occurrence.
  useEffect(() => {
    if (!selectedId) return
    const trail = pathTo(groups, selectedId)
    if (!trail) return
    setExpanded((prev) => {
      if (trail.every((k) => prev.has(k))) return prev
      const next = new Set(prev)
      for (const k of trail) next.add(k)
      return next
    })
  }, [selectedId, groups])

  useEffect(() => {
    if (!selectedId) return
    const row = rows.find((r) => r.item?.nodeId === selectedId)
    if (!row) return
    setActive(row.key)
    refs.current.get(row.key)?.scrollIntoView({ block: 'nearest' })
    // Only when the selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const activeKey = active && rows.some((r) => r.key === active) ? active : (rows[0]?.key ?? null)

  const focusRow = (key: string | undefined) => {
    if (!key) return
    setActive(key)
    refs.current.get(key)?.focus()
  }

  const toggle = (key: string, open?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      const want = open ?? !prev.has(key)
      if (want) next.add(key)
      else next.delete(key)
      return next
    })

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>, row: Row, i: number) => {
    switch (e.key) {
      case 'ArrowDown':
        focusRow(rows[i + 1]?.key)
        break
      case 'ArrowUp':
        focusRow(rows[i - 1]?.key)
        break
      case 'Home':
        focusRow(rows[0]?.key)
        break
      case 'End':
        focusRow(rows[rows.length - 1]?.key)
        break
      case 'ArrowRight':
        if (row.hasChildren && !expanded.has(row.key)) toggle(row.key, true)
        else if (row.hasChildren) focusRow(rows[i + 1]?.key)
        break
      case 'ArrowLeft':
        if (row.hasChildren && expanded.has(row.key)) toggle(row.key, false)
        else if (row.parent) focusRow(row.parent)
        break
      case 'Enter':
      case ' ':
        if (row.item) onSelect(row.item.nodeId)
        else toggle(row.key)
        break
      case '*': {
        const siblings = rows.filter((r) => r.parent === row.parent && r.hasChildren).map((r) => r.key)
        setExpanded((prev) => new Set([...prev, ...siblings]))
        break
      }
      default:
        return
    }
    e.preventDefault()
  }

  if (rows.length === 0) return <p className="rounded-card bg-surface p-6 text-sm text-ink-2 shadow-inset-line">No node matches these filters. Clear a filter to see more of the graph.</p>

  return (
    <div role="tree" aria-label="Reuse graph as a tree" className="min-w-0 overflow-hidden rounded-card bg-surface shadow-inset-line">
      {rows.map((row, i) => {
        const open = expanded.has(row.key)
        const indent = { paddingLeft: `${0.75 + Math.min(row.level - 1, 7) * 1.05}rem` }
        if (row.group) {
          const g = row.group
          return (
            <div
              key={row.key}
              ref={(el) => {
                if (el) refs.current.set(row.key, el)
                else refs.current.delete(row.key)
              }}
              role="treeitem"
              aria-level={row.level}
              aria-expanded={open}
              aria-posinset={row.posinset}
              aria-setsize={row.setsize}
              aria-selected={false}
              tabIndex={activeKey === row.key ? 0 : -1}
              onFocus={() => setActive(row.key)}
              onClick={() => toggle(row.key)}
              onKeyDown={(e) => onKeyDown(e, row, i)}
              style={indent}
              className="flex min-w-0 cursor-pointer items-center gap-2 border-b border-line bg-paper-2/60 py-3 pr-4 outline-none first:rounded-t-card focus-visible:bg-paper-2 focus-visible:shadow-[inset_3px_0_0_rgb(var(--ink))]"
            >
              <ChevronRight aria-hidden="true" className={cx('size-4 shrink-0 text-ink-2 transition-transform duration-fast', open && 'rotate-90')} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink">
                  {g.label} <span className="il-num font-mono text-xs font-medium text-ink-2">· {g.items.length}</span>
                </span>
                <span className="block text-xs text-ink-2">{g.description}</span>
              </span>
            </div>
          )
        }
        const it = row.item!
        const node = index.nodes.get(it.nodeId)
        if (!node) return null
        const selected = node.id === selectedId
        const dim = highlight ? !highlight.nodes.has(node.id) : false
        const sfId = node.type === 'safety-function' ? node.safetyFunctionIds[0] : undefined
        const status = sfId ? sfStatus.get(sfId) : undefined
        return (
          <div
            key={row.key}
            ref={(el) => {
              if (el) refs.current.set(row.key, el)
              else refs.current.delete(row.key)
            }}
            role="treeitem"
            aria-level={row.level}
            aria-expanded={row.hasChildren ? open : undefined}
            aria-posinset={row.posinset}
            aria-setsize={row.setsize}
            aria-selected={selected}
            tabIndex={activeKey === row.key ? 0 : -1}
            onFocus={() => setActive(row.key)}
            onClick={() => onSelect(node.id)}
            onKeyDown={(e) => onKeyDown(e, row, i)}
            style={indent}
            className={cx(
              'group flex min-w-0 cursor-pointer items-start gap-2 border-b border-line py-2.5 pr-3 outline-none transition-[background-color,opacity] duration-fast last:border-0 sm:pr-4',
              selected ? 'bg-ink/[0.07] shadow-[inset_3px_0_0_rgb(var(--ink))]' : 'hover:bg-paper-2/60',
              'focus-visible:bg-paper-2 focus-visible:shadow-[inset_3px_0_0_rgb(var(--focus))]',
              dim && 'opacity-45',
            )}
          >
            <span
              aria-hidden="true"
              onClick={(e) => {
                e.stopPropagation()
                if (row.hasChildren) toggle(row.key)
              }}
              className={cx('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[6px] text-ink-2 hover:bg-ink/[0.07]', !row.hasChildren && 'invisible')}
            >
              <ChevronRight className={cx('size-4 transition-transform duration-fast', open && 'rotate-90')} />
            </span>
            <span className={cx('mt-[3px] flex size-[22px] shrink-0 items-center justify-center rounded-[7px]', node.type === 'safety-function' ? 'bg-ink text-paper' : 'bg-ink/[0.06] text-ink-2')}>
              <TypeIcon type={node.type} className="size-3" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cx('il-ident min-w-0 font-mono text-[0.8125rem] font-semibold text-ink', node.change === 'removed' && 'line-through decoration-coral-ink')}>{node.label}</span>
                <ChangeMarker change={node.change} />
                {node.severity && (
                  <span className="inline-flex items-center gap-1 font-mono text-[0.625rem] font-semibold tracking-[0.06em] text-ink">
                    <Glyph shape={SEVERITY_META[node.severity].shape} className={cx('size-2.5', node.severity === 'CRITICAL' ? 'fill-coral' : node.severity === 'HIGH' ? 'fill-marigold' : node.severity === 'INFO' ? 'fill-iris' : 'fill-ink-2')} />
                    {node.severity}
                  </span>
                )}
                {status && <StatusPill status={status} className="h-5 px-2 text-[0.625rem]" />}
              </span>
              <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
                {it.relation && <span className="font-mono text-[0.6875rem] text-ink-3">{it.relation} ·</span>}
                <span>{NODE_TYPE_LABEL[node.type]}</span>
                {node.sublabel && <span className="il-ident min-w-0 font-mono text-[0.6875rem]">{node.sublabel}</span>}
                {node.findingIds.length > 0 && <span className="font-mono text-[0.6875rem] text-ink">{node.findingIds.join(' ')}</span>}
                <ScopeMarker node={node} />
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}
