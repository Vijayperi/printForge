import { Container, Section } from "@/src/components/layout/primitives"

/**
 * Placeholder for the interactive 3D demo. Session 6 replaces the inner tile
 * with the real deferred-loaded ModelViewer; the outer contract (id, heading,
 * caption) must stay stable.
 */
export function DemoSlot() {
  return (
    <Section id="demo" aria-label="3D preview demo" className="py-8">
      <Container>
        <div className="flex aspect-video w-full items-center justify-center rounded-2xl border bg-gradient-to-br from-muted to-secondary">
          <p className="px-6 text-center text-muted-foreground">
            Interactive 3D preview — rotate, zoom, and inspect your model right in the browser.
          </p>
        </div>
      </Container>
    </Section>
  )
}
