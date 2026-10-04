/**
 * NotificationPath — an alarm's path to the operator, before vs after.
 *
 *   <NotificationPath path={sf.notification} />            full: two rows + stage details
 *   <NotificationPath path={sf.notification} compact />    one row (current), for lists and maps
 *
 * Stages: CONDITION → LOGIC → ALARM → HMI → OPERATOR. Each cell shows its
 * state as a glyph AND a word (OK, CONDITIONAL, BROKEN, DECLARED, UNKNOWN), so
 * nothing depends on color. Stages whose state changed are the "affected
 * segment": their connector draws in coral (a one-off animation, static under
 * reduced motion) and their detail text is listed below the path. HMI and
 * OPERATOR are usually DECLARED: a project file cannot prove what an HMI shows.
 */
import { Fragment } from 'react'
import { motion } from 'motion/react'
import type { NotificationPath as NotificationPathModel, NotificationStage, StageState } from '@interlock/core/types'
import { cx } from '../../lib/cx.ts'
import { Glyph, StatusPill } from '../../ui/Badge.tsx'
import type { GlyphShape } from '../../ui/Badge.tsx'

export interface NotificationPathProps {
  path: NotificationPathModel
  compact?: boolean
  className?: string
}

const STATE: Record<StageState, { shape: GlyphShape; cls: string; cell: string }> = {
  OK: { shape: 'check', cls: 'text-ink', cell: 'bg-surface ring-1 ring-inset ring-line' },
  CONDITIONAL: { shape: 'half', cls: 'text-marigold-ink fill-marigold', cell: 'bg-marigold/[0.16] ring-1 ring-inset ring-marigold/50' },
  BROKEN: { shape: 'cross', cls: 'text-coral-ink', cell: 'bg-coral/[0.12] ring-1 ring-inset ring-coral/45' },
  DECLARED: { shape: 'ring', cls: 'text-ink-2', cell: 'border border-dashed border-line-strong' },
  UNKNOWN: { shape: 'ring', cls: 'text-ink-3', cell: 'border border-dashed border-ink-3' },
}

const changed = (s: NotificationStage) => s.before !== s.after

function StateCell({ state, emphasis, delay, instant }: { state: StageState; emphasis: boolean; delay: number; instant?: boolean }) {
  const m = STATE[state]
  return (
    <motion.div
      initial={emphasis && !instant ? { opacity: 0.4 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35, delay }}
      className={cx('flex min-h-9 min-w-0 items-center gap-1.5 rounded-[10px] px-2.5 py-1.5', m.cell)}
    >
      <Glyph shape={m.shape} className={cx('size-3', m.cls)} />
      <span className={cx('truncate font-mono text-[0.6875rem] font-medium tracking-[0.04em]', m.cls)}>{state}</span>
    </motion.div>
  )
}

/** Horizontal connector between two cells; coral and drawn when the next stage is affected. */
function Connector({ affected, delay }: { affected: boolean; delay: number }) {
  return (
    <span aria-hidden="true" className="relative mx-0.5 h-[2px] w-full min-w-3 self-center overflow-hidden rounded-full bg-line-strong">
      {affected && (
        <motion.span
          className="absolute inset-0 origin-left bg-coral"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.4, delay, ease: [0.45, 0, 0.55, 1] }}
        />
      )}
    </span>
  )
}

function Header({ path }: { path: NotificationPathModel }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <p className="il-label">Notification path</p>
        <p className="il-ident mt-0.5 font-mono text-data font-semibold text-ink">
          {path.alarmTag}
          <span className="font-normal text-ink-2"> · {path.mechanism === 'ALMD' ? 'ALMD alarm' : path.mechanism === 'BOOL_TAG' ? 'BOOL alarm tag' : 'unresolved alarm'}</span>
        </p>
      </div>
      <StatusPill status={path.status} />
    </div>
  )
}

export function NotificationPath({ path, compact = false, className }: NotificationPathProps) {
  const stages = path.stages
  const affected = stages.filter(changed)
  const firstAffected = stages.findIndex(changed)
  const summary = stages.map((s) => `${s.label}: ${s.before === s.after ? s.after : `${s.before} → ${s.after}`}`).join('; ')

  if (compact) {
    return (
      <div className={cx('min-w-0', className)}>
        <p className="sr-only">
          Notification path for {path.alarmTag}, status {path.status.replace(/_/g, ' ')}. {summary}.
        </p>
        <ol aria-hidden="true" className="flex min-w-0 items-center">
          {stages.map((s, i) => {
            const m = STATE[s.after]
            return (
              <Fragment key={s.id}>
                {i > 0 && <Connector affected={changed(s)} delay={0.1 * (i - Math.max(firstAffected, 0))} />}
                <li className="flex shrink-0 flex-col items-center gap-1" title={`${s.label}: ${s.before} → ${s.after}`}>
                  <span className={cx('flex size-6 items-center justify-center rounded-full', m.cell)}>
                    <Glyph shape={m.shape} className={cx('size-3', m.cls)} />
                  </span>
                  <span className={cx('font-mono text-[0.5625rem] tracking-[0.06em]', changed(s) ? 'font-semibold text-coral-ink' : 'text-ink-2')}>{s.id}</span>
                </li>
              </Fragment>
            )
          })}
        </ol>
      </div>
    )
  }

  return (
    <div className={cx('flex min-w-0 flex-col gap-5', className)}>
      <Header path={path} />

      {/* Desktop / tablet: two aligned rows */}
      <div className="hidden sm:block">
        <table className="w-full table-fixed border-separate border-spacing-0 text-left">
          <caption className="sr-only">Notification path stages for {path.alarmTag}, before and after</caption>
          <thead>
            <tr>
              <th scope="col" className="w-20">
                <span className="sr-only">Version</span>
              </th>
              {stages.map((s, i) => (
                <th key={s.id} scope="col" className={cx('pb-2', i > 0 && 'pl-6')}>
                  <span className={cx('il-label', changed(s) && 'text-coral-ink')}>{s.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(['before', 'after'] as const).map((row) => (
              <tr key={row}>
                <th scope="row" className="py-1.5 pr-3 align-middle font-mono text-[0.6875rem] font-medium tracking-[0.08em] text-ink-2">
                  {row === 'before' ? 'BEFORE' : 'AFTER'}
                </th>
                {stages.map((s, i) => (
                  <td key={s.id} className="py-1.5 align-middle">
                    <div className="flex items-center">
                      {i > 0 && (
                        <span className="flex w-6 shrink-0">
                          <Connector affected={row === 'after' && changed(s)} delay={0.12 * (i - Math.max(firstAffected, 0))} />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <StateCell state={s[row]} emphasis={row === 'after' && changed(s)} delay={0.12 * (i - Math.max(firstAffected, 0)) + 0.2} />
                      </div>
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: one row per stage */}
      <ol className="flex flex-col gap-2 sm:hidden">
        {stages.map((s) => (
          <li key={s.id} className={cx('rounded-input px-3.5 py-2.5', changed(s) ? 'bg-coral/[0.07] ring-1 ring-inset ring-coral/35' : 'bg-paper-2/70')}>
            <div className="flex items-center justify-between gap-3">
              <span className={cx('il-label', changed(s) && 'text-coral-ink')}>{s.label}</span>
              <span className="flex items-center gap-1.5 font-mono text-[0.6875rem]">
                <span className="text-ink-2">{s.before}</span>
                {changed(s) && (
                  <>
                    <span aria-hidden="true" className="text-ink-3">
                      →
                    </span>
                    <span className="sr-only"> changed to </span>
                    <span className={cx('font-semibold', STATE[s.after].cls)}>{s.after}</span>
                  </>
                )}
              </span>
            </div>
          </li>
        ))}
      </ol>

      {affected.length > 0 && (
        <ul className="flex flex-col gap-2 border-t border-line pt-4">
          {affected.map((s) => (
            <li key={s.id} className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm sm:grid-cols-[6rem_minmax(0,1fr)]">
              <span className="il-label pt-0.5 text-coral-ink">{s.label}</span>
              <span className="il-ident text-ink">{s.detail}</span>
            </li>
          ))}
        </ul>
      )}

      {(path.suppressors.length > 0 || path.declaredNotification) && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
          {path.suppressors.length > 0 && (
            <>
              <dt className="il-label pt-0.5">Suppressed by</dt>
              <dd className="flex flex-wrap gap-1.5">
                {path.suppressors.map((x) => (
                  <code key={x} className="il-ident rounded-[6px] bg-coral/[0.1] px-1.5 py-0.5 font-mono text-data text-coral-ink ring-1 ring-inset ring-coral/30">
                    {x}
                  </code>
                ))}
              </dd>
            </>
          )}
          {path.declaredNotification && (
            <>
              <dt className="il-label pt-0.5">Declared notification</dt>
              <dd className="il-ident text-ink-2">{path.declaredNotification} (declared; not provable from the project file)</dd>
            </>
          )}
        </dl>
      )}

      {affected.length === 0 && <p className="text-sm text-ink-2">No stage of this path changed.</p>}

      <details className="group text-sm">
        <summary className="cursor-pointer list-none font-semibold text-ink [&::-webkit-details-marker]:hidden">
          <span className="underline decoration-ink-3 underline-offset-4 group-open:decoration-ink">All stage details</span>
        </summary>
        <ul className="mt-3 flex flex-col gap-1.5">
          {stages.map((s) => (
            <li key={s.id} className="grid grid-cols-1 gap-x-4 sm:grid-cols-[6rem_minmax(0,1fr)]">
              <span className="il-label pt-0.5">{s.label}</span>
              <span className="il-ident text-ink-2">{s.detail}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
