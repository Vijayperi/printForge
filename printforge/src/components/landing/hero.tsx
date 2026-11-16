import Link from "next/link"

import { Container, Section } from "@/src/components/layout/primitives"
import { Button } from "@/src/components/ui/button"
import { Input } from "@/src/components/ui/input"
import { landingContent } from "@/src/config/content"

export function Hero() {
  const { hero } = landingContent
  return (
    <Section className="pb-8 text-center">
      <Container className="flex max-w-3xl flex-col items-center gap-6">
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">{hero.headline}</h1>
        <p className="max-w-2xl text-lg text-muted-foreground">{hero.subheadline}</p>
        <form action="/projects" className="flex w-full max-w-xl gap-2" role="search">
          <Input
            name="prompt"
            aria-label={hero.promptPlaceholder}
            placeholder={hero.promptPlaceholder}
            className="h-11"
          />
          <Button type="submit" size="lg">
            {hero.primaryCta}
          </Button>
        </form>
        <div className="flex gap-4">
          <Button variant="link" asChild>
            <Link href="#examples">{hero.secondaryCta}</Link>
          </Button>
        </div>
      </Container>
    </Section>
  )
}
