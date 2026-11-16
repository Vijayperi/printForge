import { Container, PageHeader, Section } from "@/src/components/layout/primitives"
import { landingContent } from "@/src/config/content"
import { cn } from "@/src/lib/utils"

export function ExamplesGrid() {
  return (
    <Section id="examples" className="bg-muted/40">
      <Container className="space-y-8">
        <PageHeader
          title="What people make"
          description="Decorative, novelty, gift, and simple functional objects — no CAD skills needed."
        />
        <ul className="grid list-none gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {landingContent.examples.map((example) => (
            <li key={example.title} className="overflow-hidden rounded-xl border bg-card">
              <div
                aria-hidden="true"
                className={cn("aspect-square w-full bg-gradient-to-br", example.tileClass)}
              />
              <div className="space-y-1 p-4">
                <h3 className="font-semibold">{example.title}</h3>
                <p className="text-sm text-muted-foreground">{example.useCase}</p>
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  )
}
