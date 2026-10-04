/**
 * Reveal — fades content up once as it enters the viewport.
 * Under reduced motion MotionConfig drops the transform; opacity still eases.
 */
import type { ReactNode } from 'react'
import { motion } from 'motion/react'

export function Reveal({ children, delay = 0, className, as = 'div' }: { children: ReactNode; delay?: number; className?: string; as?: 'div' | 'section' | 'li' }) {
  const Comp = as === 'section' ? motion.section : as === 'li' ? motion.li : motion.div
  return (
    <Comp
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </Comp>
  )
}

/** Small mono tag that marks an illustration as an example, so no specimen reads as a real result. */
export function ExampleTag({ children = 'Example · Northgate Pump Station (synthetic)' }: { children?: ReactNode }) {
  return <p className="font-mono text-[0.6875rem] tracking-[0.04em] text-ink-2">{children}</p>
}
