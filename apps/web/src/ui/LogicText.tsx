/**
 * LogicText / CodeBlock — monospace rung or condition text with token coloring.
 *
 *   <LogicText text="XIC(PT201_High)XIC(Safety_Enable)XIO(Maintenance_Mode)OTE(C201_Shutdown_Cmd);" />
 *   <LogicText language="condition" text="Pressure_High AND Safety_Enable AND NOT Maintenance_Mode" />
 *   <CodeBlock label="Rung 0 · Compressor/Main" text={rung.text} />
 *
 * Coloring is structural and restrained: instruction mnemonics semibold,
 * module (AOI) calls in iris, outputs underlined, branch brackets bold, tags in
 * full ink. `marks` (from diffUnits) renders <ins>/<del> for changed terms, so
 * the change is announced and visible without color.
 */
import { Fragment } from 'react'
import type { ReactNode } from 'react'
import { cx } from '../lib/cx.ts'
import { INSTRUCTIONS, OUTPUT_INSTRUCTIONS, splitCondition, splitRung } from './logicTokens.ts'
import type { DiffMark, Unit } from './logicTokens.ts'

export type LogicLanguage = 'rung' | 'condition'

function renderCall(text: string): ReactNode {
  const open = text.indexOf('(')
  const name = text.slice(0, open)
  const inner = text.slice(open + 1, text.endsWith(')') ? -1 : undefined)
  const isInstr = INSTRUCTIONS.has(name.toUpperCase())
  const isOutput = OUTPUT_INSTRUCTIONS.has(name.toUpperCase())
  const operands = inner.split(',')
  return (
    <>
      <span
        className={cx(
          'font-semibold',
          isInstr ? 'text-ink-2' : 'text-iris-ink',
          isOutput && 'underline decoration-ink-3 decoration-1 underline-offset-[3px]',
        )}
      >
        {name}
      </span>
      <span className="text-ink-3">(</span>
      {operands.map((op, i) => (
        <span key={i}>
          {i > 0 && <span className="text-ink-3">,</span>}
          <span className={/^-?\d+(\.\d+)?$/.test(op.trim()) ? 'text-ink-2' : 'text-ink'}>{op}</span>
        </span>
      ))}
      {text.endsWith(')') && <span className="text-ink-3">)</span>}
    </>
  )
}

function renderUnit(u: Unit): ReactNode {
  switch (u.kind) {
    case 'call':
      return renderCall(u.text)
    case 'branch':
      return <span className={cx('font-bold', u.text === ',' ? 'text-ink-3' : 'text-ink-2')}>{u.text}</span>
    case 'end':
      return <span className="text-ink-3">{u.text}</span>
    case 'keyword':
      return <span className={cx('text-[0.92em] font-semibold tracking-[0.04em]', u.text === 'NOT' ? 'text-ink' : 'text-ink-2')}>{u.text}</span>
    case 'paren':
      return <span className="text-ink-3">{u.text}</span>
    case 'word':
      return <span className="text-ink">{u.text}</span>
    default:
      return u.text
  }
}

/** Groups consecutive units with the same non-'same' mark so a changed run renders as one <ins>/<del>. */
function groupRuns(units: Unit[], marks?: DiffMark[]): Array<{ mark: DiffMark; items: Unit[]; start: number }> {
  const out: Array<{ mark: DiffMark; items: Unit[]; start: number }> = []
  units.forEach((u, i) => {
    const mark = marks?.[i] ?? 'same'
    const last = out[out.length - 1]
    if (last && mark !== 'same' && last.mark === mark) last.items.push(u)
    else out.push({ mark, items: [u], start: i })
  })
  return out
}

export function tokenize(text: string, language: LogicLanguage): Unit[] {
  return language === 'rung' ? splitRung(text) : splitCondition(text)
}

export interface LogicTextProps {
  text: string
  language?: LogicLanguage
  marks?: DiffMark[]
  units?: Unit[]
  className?: string
  /** Wrap long rungs (default) or keep on one line with horizontal scroll. */
  wrap?: boolean
}

export function LogicText({ text, language = 'rung', marks, units: unitsProp, className, wrap = true }: LogicTextProps) {
  const units = unitsProp ?? tokenize(text, language)
  return (
    <code className={cx('block font-mono text-data leading-[1.7]', wrap ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre', className)}>
      {groupRuns(units, marks).map(({ mark, items, start }) => {
        const i = start
        const u = items[0]!
        const content = items.length === 1 ? renderUnit(u) : items.map((it, k) => <span key={k}>{renderUnit(it)}</span>)
        if (mark === 'added')
          return (
            <Fragment key={i}>
            <ins className="rounded-[4px] bg-marigold/40 px-[2px] no-underline shadow-[inset_0_-2px_0_rgb(var(--marigold-ink)/0.55)] [box-decoration-break:clone]">
              <span className="sr-only">added: </span>
              {content}
            </ins>
            <wbr />
            </Fragment>
          )
        if (mark === 'removed')
          return (
            <Fragment key={i}>
            <del className="rounded-[4px] bg-ink/[0.07] px-[2px] decoration-ink-2 decoration-[1.5px] [box-decoration-break:clone]">
              <span className="sr-only">removed: </span>
              {content}
            </del>
            <wbr />
            </Fragment>
          )
        return (
          <span key={i}>
            {content}
            {/* break opportunity between rung elements, so wrapping never splits a tag name */}
            {(u.kind === 'call' || u.kind === 'branch') && <wbr />}
          </span>
        )
      })}
    </code>
  )
}

export interface CodeBlockProps extends LogicTextProps {
  label?: ReactNode
  meta?: ReactNode
}

export function CodeBlock({ label, meta, className, ...rest }: CodeBlockProps) {
  return (
    <figure className={cx('min-w-0 overflow-hidden rounded-input bg-paper-2/70 shadow-inset-line', className)}>
      {(label || meta) && (
        <figcaption className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-2">
          {label && <span className="il-label il-ident">{label}</span>}
          {meta && <span className="il-ident font-mono text-[0.6875rem] text-ink-2">{meta}</span>}
        </figcaption>
      )}
      <div className="px-4 py-3">
        <LogicText {...rest} />
      </div>
    </figure>
  )
}
