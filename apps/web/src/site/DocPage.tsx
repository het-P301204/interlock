/**
 * DocPage — long-form editorial layout: title block, sticky table of contents
 * (desktop), numbered or plain sections.
 *
 *   <DocPage eyebrow="Documentation" title="How INTERLOCK works" lede="…"
 *            sections={[{ id: 'pipeline', title: 'The pipeline', body: <>…</> }]} />
 */
import type { ReactNode } from 'react'
import { cx } from '../lib/cx.ts'
import { useDocumentTitle } from '../lib/hooks.ts'

export interface DocSection {
  id: string
  title: string
  body: ReactNode
}

export function DocPage({ eyebrow, title, lede, sections, numbered = false, docTitle }: { eyebrow: string; title: string; lede: ReactNode; sections: DocSection[]; numbered?: boolean; docTitle: string }) {
  useDocumentTitle(docTitle)
  return (
    <article className="mx-auto max-w-page px-4 pb-24 pt-12 sm:px-6 lg:px-10 lg:pt-20">
      <header className="max-w-4xl">
        <p className="il-label mb-5 text-ink">{eyebrow}</p>
        <h1 className="text-display-2 text-ink [text-wrap:balance]">{title}</h1>
        <div className="mt-6 max-w-2xl text-lede text-ink-2">{lede}</div>
      </header>

      <div className="mt-16 grid grid-cols-1 gap-12 border-t border-line pt-12 lg:grid-cols-12">
        <nav aria-label="On this page" className="hidden lg:col-span-3 lg:block">
          <div className="sticky top-24">
            <p className="il-label mb-3">On this page</p>
            <ol className="flex flex-col gap-1 border-l border-line">
              {sections.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="-ml-px block border-l border-transparent py-1 pl-4 text-sm text-ink-2 hover:border-ink hover:text-ink">
                    {numbered && <span className="il-num mr-2 font-mono text-xs text-ink-3">{String(i + 1).padStart(2, '0')}</span>}
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>
        <div className="flex min-w-0 flex-col gap-16 lg:col-span-8 lg:col-start-5">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-24">
              <h2 id={`${s.id}-h`} className={cx('text-title-2 text-ink', numbered && 'flex items-baseline gap-4')}>
                {numbered && <span className="il-num font-mono text-sm font-semibold text-ink-3">{String(i + 1).padStart(2, '0')}</span>}
                {s.title}
              </h2>
              <div className="il-prose mt-5 text-[0.9875rem]">{s.body}</div>
            </section>
          ))}
        </div>
      </div>
    </article>
  )
}

/** A definition list for doc pages: term in mono, description in prose. */
export function DocList({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="mt-5 divide-y divide-line rounded-card bg-surface shadow-inset-line">
      {items.map(([k, v]) => (
        <div key={k} className="grid grid-cols-1 gap-1 px-5 py-3.5 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-6">
          <dt className="il-ident font-mono text-xs font-semibold uppercase tracking-[0.08em] text-ink">{k}</dt>
          <dd className="text-sm leading-relaxed text-ink-2">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
