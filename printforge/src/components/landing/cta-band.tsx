import Link from "next/link"

import { Container, Section } from "@/src/components/layout/primitives"
import { Button } from "@/src/components/ui/button"
import { landingContent } from "@/src/config/content"

export function CtaBand() {
  return (
    <Section aria-label="Get started" className="py-12">
      <Container className="flex flex-col items-center gap-4 rounded-2xl bg-primary px-6 py-12 text-center text-primary-foreground">
        <h2 className="text-2xl font-semibold sm:text-3xl">Ready to make something real?</h2>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild variant="secondary" size="lg">
            <Link href="/projects">{landingContent.hero.primaryCta}</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
          >
            <Link href="#examples">{landingContent.hero.secondaryCta}</Link>
          </Button>
        </div>
      </Container>
    </Section>
  )
}
