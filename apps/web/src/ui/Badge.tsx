/**
 * Badges and pills. Pills are reserved for statuses, severity, format tags and
 * compact filters.
 *
 *   <Badge>EXPERIMENTAL</Badge>                  neutral mono tag
 *   <SeverityBadge severity="CRITICAL" />        label + distinct glyph per level
 *   <SeverityBadge severity="HIGH" solid />      filled variant for headers
 *   <StatusPill status="READY_WITH_WARNINGS" />  trust / safety / readiness statuses
 *
 * Severity is never conveyed by color alone: every level has its own glyph
 * shape (octagon, triangle, diamond, circle, square) and its text label.
 */
import type { ReactNode } from 'react'
import type { Severity } from '@interlock/core/types'
import { cx } from '../lib/cx.ts'
import { enumLabel } from '../lib/format.ts'

export type Tone = 'neutral' | 'coral' | 'marigold' | 'sage' | 'iris' | 'outline'

const soft: Record<Tone, string> = {
  neutral: 'bg-ink/[0.06] text-ink-2 ring-ink/10',
  coral: 'bg-coral/[0.14] text-coral-ink ring-coral/35',
  marigold: 'bg-marigold/[0.2] text-marigold-ink ring-marigold/45',
  sage: 'bg-sage/[0.18] text-sage-ink ring-sage/40',
  iris: 'bg-iris/[0.16] text-iris-ink ring-iris/40',
  outline: 'bg-transparent text-ink-2 ring-line-strong',
}

const solid: Record<Tone, string> = {
  neutral: 'bg-ink text-paper ring-ink',
  coral: 'bg-coral text-[rgb(var(--ink-fixed))] ring-coral',
  marigold: 'bg-marigold text-[rgb(var(--ink-fixed))] ring-marigold',
  sage: 'bg-sage text-[rgb(var(--ink-fixed))] ring-sage',
  iris: 'bg-iris text-[rgb(var(--ink-fixed))] ring-iris',
  outline: 'bg-transparent text-ink ring-ink',
}

export const glyphFill: Record<Tone, string> = {
  neutral: 'fill-ink-2',
  coral: 'fill-coral',
  marigold: 'fill-marigold',
  sage: 'fill-sage',
  iris: 'fill-iris',
  outline: 'fill-ink-2',
}

export interface BadgeProps {
  children: ReactNode
  tone?: Tone
  solid?: boolean
  size?: 'sm' | 'md'
  icon?: ReactNode
  className?: string
  dashed?: boolean
}

export function Badge({ children, tone = 'neutral', solid: isSolid = false, size = 'sm', icon, className, dashed }: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-mono font-medium uppercase tracking-[0.06em] ring-1 ring-inset',
        size === 'sm' ? 'h-6 px-2.5 text-[0.6875rem]' : 'h-7 px-3 text-xs',
        isSolid ? solid[tone] : soft[tone],
        dashed && 'outline-dashed outline-1 outline-offset-[-1px] outline-line-strong ring-0',
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}

/* ---------------------------------------------------------------- glyphs */

export type GlyphShape = 'octagon' | 'triangle' | 'diamond' | 'circle' | 'square' | 'ring' | 'half' | 'dash' | 'check' | 'cross'

export function Glyph({ shape, className }: { shape: GlyphShape; className?: string }) {
  const common = { 'aria-hidden': true, viewBox: '0 0 12 12', className: cx('size-3 shrink-0', className) } as const
  switch (shape) {
    case 'octagon':
      return (
        <svg {...common}>
          <path d="M4 .8h4L11.2 4v4L8 11.2H4L.8 8V4z" />
        </svg>
      )
    case 'triangle':
      return (
        <svg {...common}>
          <path d="M6 .9l5.4 9.6H.6z" />
        </svg>
      )
    case 'diamond':
      return (
        <svg {...common}>
          <path d="M6 .6L11.4 6 6 11.4.6 6z" />
        </svg>
      )
    case 'circle':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4.6" />
        </svg>
      )
    case 'square':
      return (
        <svg {...common}>
          <rect x="1.6" y="1.6" width="8.8" height="8.8" rx="1.4" />
        </svg>
      )
    case 'ring':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4" fill="none" strokeWidth="1.8" className="stroke-current" />
        </svg>
      )
    case 'half':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4.3" fill="none" strokeWidth="1.5" className="stroke-current" />
          <path d="M6 1.7a4.3 4.3 0 010 8.6z" />
        </svg>
      )
    case 'dash':
      return (
        <svg {...common}>
          <rect x="1.5" y="5" width="9" height="2" rx="1" />
        </svg>
      )
    case 'check':
      return (
        <svg {...common}>
          <path d="M2.2 6.4l2.5 2.4 5.1-5.6" fill="none" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="stroke-current" />
        </svg>
      )
    case 'cross':
      return (
        <svg {...common}>
          <path d="M3 3l6 6M9 3L3 9" fill="none" strokeWidth="1.9" strokeLinecap="round" className="stroke-current" />
        </svg>
      )
  }
}

/* -------------------------------------------------------------- severity */

export const SEVERITY_META: Record<Severity, { label: string; tone: Tone; shape: GlyphShape; description: string }> = {
  CRITICAL: { label: 'CRITICAL', tone: 'coral', shape: 'octagon', description: 'Protection removed, bypassed or suppressed' },
  HIGH: { label: 'HIGH', tone: 'marigold', shape: 'triangle', description: 'Protection weakened' },
  MEDIUM: { label: 'MEDIUM', tone: 'outline', shape: 'diamond', description: 'Needs engineering review' },
  LOW: { label: 'LOW', tone: 'neutral', shape: 'circle', description: 'Cosmetic or equivalent change' },
  INFO: { label: 'INFO', tone: 'iris', shape: 'square', description: 'Recorded for completeness' },
}

export function SeverityBadge({ severity, solid: isSolid, size, className }: { severity: Severity; solid?: boolean; size?: 'sm' | 'md'; className?: string }) {
  const meta = SEVERITY_META[severity]
  return (
    <Badge
      tone={meta.tone}
      solid={isSolid}
      size={size}
      className={className}
      icon={<Glyph shape={meta.shape} className={isSolid ? 'fill-current' : meta.tone === 'outline' ? 'fill-ink' : glyphFill[meta.tone]} />}
    >
      {meta.label}
    </Badge>
  )
}

/* --------------------------------------------------------------- statuses */

const STATUS: Record<string, { tone: Tone; shape: GlyphShape; label?: string; dashed?: boolean }> = {
  // trust
  VERIFIED_SCOPE: { tone: 'sage', shape: 'check' },
  PARTIAL_COVERAGE: { tone: 'marigold', shape: 'half' },
  REVIEW_REQUIRED: { tone: 'coral', shape: 'triangle' },
  // safety function status
  IMPACTED: { tone: 'coral', shape: 'octagon' },
  STRENGTHENED: { tone: 'sage', shape: 'check' },
  CHANGED_EQUIVALENT: { tone: 'iris', shape: 'square', label: 'CHANGED · EQUIVALENT' },
  NO_CHANGE: { tone: 'neutral', shape: 'dash', label: 'NO CHANGE' },
  NOT_ANALYZED: { tone: 'outline', shape: 'ring', label: 'NOT ANALYZED', dashed: true },
  // readiness
  READY: { tone: 'sage', shape: 'check' },
  READY_WITH_WARNINGS: { tone: 'marigold', shape: 'triangle' },
  BLOCKED: { tone: 'coral', shape: 'cross' },
  // notification
  INTACT: { tone: 'sage', shape: 'check' },
  DEGRADED: { tone: 'marigold', shape: 'half' },
  SUPPRESSED: { tone: 'coral', shape: 'octagon' },
  BROKEN: { tone: 'coral', shape: 'cross' },
  // disposition / misc
  UNDECLARED: { tone: 'outline', shape: 'ring', dashed: true },
  REVIEW: { tone: 'outline', shape: 'triangle' },
  POSITIVE: { tone: 'sage', shape: 'check' },
  INFORMATIONAL: { tone: 'iris', shape: 'square' },
  DRIFT: { tone: 'marigold', shape: 'triangle' },
  CONSISTENT: { tone: 'sage', shape: 'check' },
  SUPPORTED: { tone: 'sage', shape: 'check' },
  PLANNED: { tone: 'outline', shape: 'ring', dashed: true },
  EXPERIMENTAL: { tone: 'iris', shape: 'diamond' },
  LOCAL: { tone: 'sage', shape: 'circle' },
  PENDING: { tone: 'outline', shape: 'ring' },
  RUNNING: { tone: 'iris', shape: 'half' },
  COMPLETE: { tone: 'sage', shape: 'check' },
  FAILED: { tone: 'coral', shape: 'cross' },
  CANCELLED: { tone: 'neutral', shape: 'dash' },
}

export function StatusPill({ status, label, size, className }: { status: string; label?: string; size?: 'sm' | 'md'; className?: string }) {
  const meta = STATUS[status] ?? { tone: 'neutral' as Tone, shape: 'circle' as GlyphShape }
  const glyphClass = meta.shape === 'ring' || meta.shape === 'check' || meta.shape === 'cross' || meta.shape === 'half' ? '' : glyphFill[meta.tone]
  return (
    <Badge tone={meta.tone} size={size} className={className} dashed={meta.dashed} icon={<Glyph shape={meta.shape} className={cx(glyphClass, meta.shape === 'half' && glyphFill[meta.tone])} />}>
      {label ?? meta.label ?? enumLabel(status)}
    </Badge>
  )
}
