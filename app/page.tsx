import { CtaBand } from "@/src/components/landing/cta-band"
import { DemoSlot } from "@/src/components/landing/demo-slot"
import { ExamplesGrid } from "@/src/components/landing/examples-grid"
import { FaqAccordion } from "@/src/components/landing/faq-accordion"
import { Hero } from "@/src/components/landing/hero"
import { MaterialsOverview } from "@/src/components/landing/materials-overview"
import { SiteFooter } from "@/src/components/landing/site-footer"
import { SiteHeader } from "@/src/components/landing/site-header"
import { ThreeStepExplainer } from "@/src/components/landing/three-step-explainer"

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <DemoSlot />
        <ThreeStepExplainer />
        <ExamplesGrid />
        <MaterialsOverview />
        <FaqAccordion />
        <CtaBand />
      </main>
      <SiteFooter />
    </>
  )
}
