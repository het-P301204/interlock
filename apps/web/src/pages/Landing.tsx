import { useDocumentTitle } from '../lib/hooks.ts'
import { Capabilities } from '../landing/Capabilities.tsx'
import { Hero } from '../landing/Hero.tsx'
import { Model, Problem } from '../landing/ProblemModel.tsx'
import { Coverage, Cta, DemoTeaser, Evidence, Trust } from '../landing/Proof.tsx'

export function Landing() {
  useDocumentTitle('')
  return (
    <>
      <Hero />
      <Problem />
      <Model />
      <Capabilities />
      <DemoTeaser />
      <Evidence />
      <Coverage />
      <Trust />
      <Cta />
    </>
  )
}
