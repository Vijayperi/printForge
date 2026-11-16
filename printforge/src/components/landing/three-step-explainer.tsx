import { Container, PageHeader, Section } from "@/src/components/layout/primitives"
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card"
import { landingContent } from "@/src/config/content"

export function ThreeStepExplainer() {
  return (
    <Section id="how-it-works">
      <Container className="space-y-8">
        <PageHeader title="How it works" description="From idea to object in three steps." />
        <ol className="grid list-none gap-4 p-0 sm:grid-cols-3">
          {landingContent.steps.map((step, index) => (
            <li key={step.title}>
              <Card className="h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
                    >
                      {index + 1}
                    </span>
                    {step.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {step.description}
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      </Container>
    </Section>
  )
}
