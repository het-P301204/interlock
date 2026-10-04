import { motion } from 'motion/react'
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { ButtonLink } from '../ui/Button.tsx'
import { HeroVisual } from './HeroVisual.tsx'

const HEADLINE = ['When PLC logic changes,', 'the diff is only the beginning.']

export function Hero() {
  let word = 0
  return (
    <section aria-labelledby="hero-title" className="mx-auto max-w-page px-4 pb-20 pt-10 sm:px-6 sm:pt-14 lg:px-10 lg:pb-28 lg:pt-16">
      <motion.p className="il-label mb-6 text-ink" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
        PLC Safety Logic Integrity &amp; Impact Analyzer
      </motion.p>
      <h1 id="hero-title" className="text-display text-ink">
        <span className="sr-only">{HEADLINE.join(' ')}</span>
        <span aria-hidden="true">
          {HEADLINE.map((line, li) => (
            <span key={li} className="block">
              {line.split(' ').map((w) => {
                const i = word++
                return (
                  <span key={`${li}-${w}-${i}`} className="inline-block overflow-hidden pb-[0.06em] align-bottom">
                    <motion.span
                      className="inline-block"
                      initial={{ y: '105%' }}
                      animate={{ y: 0 }}
                      transition={{ duration: 0.75, delay: 0.08 + i * 0.045, ease: [0.16, 1, 0.3, 1] }}
                    >
                      {w}
                    </motion.span>
                    {' '}
                  </span>
                )
              })}
            </span>
          ))}
        </span>
      </h1>
      <motion.div
        className="mt-8 grid grid-cols-1 gap-6 lg:mt-10 lg:grid-cols-12 lg:items-end lg:gap-12"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <p className="max-w-xl text-lede text-ink-2 lg:col-span-6">
          INTERLOCK traces reusable logic, evaluates declared safety functions, and reveals the operational impact hidden inside PLC project changes.
        </p>
        <div className="flex flex-col gap-4 lg:col-span-6 lg:items-end">
          <div className="flex flex-wrap gap-2.5">
            <ButtonLink to="/app/new" variant="primary" size="lg" iconRight={<ArrowRight />}>
              Analyze a Project
            </ButtonLink>
            <ButtonLink to="/app/demo" variant="secondary" size="lg">
              Explore Demo
            </ButtonLink>
          </div>
          <Link to="/how-it-works" className="group inline-flex w-fit items-center gap-1.5 rounded-[6px] text-sm font-semibold text-ink underline decoration-ink-3 underline-offset-4 hover:decoration-ink">
            How INTERLOCK Works
            <ArrowRight aria-hidden="true" className="size-3.5 transition-transform duration-fast group-hover:translate-x-0.5" />
          </Link>
        </div>
      </motion.div>

      <motion.div className="mt-12 lg:mt-14" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}>
        <HeroVisual />
      </motion.div>

      <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-ink-2">
        <li>Rockwell L5X exports</li>
        <li aria-hidden="true" className="text-ink-3">/</li>
        <li>Runs in your browser</li>
        <li aria-hidden="true" className="text-ink-3">/</li>
        <li>Never connects to a controller</li>
        <li aria-hidden="true" className="text-ink-3">/</li>
        <li>Deterministic, evidence-backed</li>
      </ul>
    </section>
  )
}
