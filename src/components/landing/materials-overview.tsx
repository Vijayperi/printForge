import { Container, PageHeader, Section } from "@/src/components/layout/primitives"
import { Badge } from "@/src/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card"
import { formatINR, inr } from "@/src/lib/money"
import { landingContent } from "@/src/config/content"

export function MaterialsOverview() {
  const { materials, pricing } = landingContent
  return (
    <Section id="materials">
      <Container className="space-y-8">
        <PageHeader title="Materials & pricing" description={pricing.note} />
        <div className="grid gap-4 sm:grid-cols-2">
          {materials.map((material) => (
            <Card key={material.name}>
              <CardHeader>
                <CardTitle>{material.name}</CardTitle>
                <CardDescription>{material.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Colours:</span>
                <ul className="flex list-none gap-1.5 p-0" aria-label={`${material.name} colours`}>
                  {material.colorHexes.map((hex) => (
                    <li
                      key={hex}
                      title={hex}
                      className="size-5 rounded-full border"
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="text-sm">
          <Badge variant="secondary" className="mr-2">
            Starting from {formatINR(inr(landingContent.pricing.startingPriceMinor))}
          </Badge>
          <span className="text-muted-foreground">
            On-screen textures are a visual preview — an FDM print is a single filament colour.
          </span>
        </p>
      </Container>
    </Section>
  )
}
