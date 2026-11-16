import Link from "next/link"

import { Container } from "@/src/components/layout/primitives"
import { Separator } from "@/src/components/ui/separator"
import { landingContent } from "@/src/config/content"

export function SiteFooter() {
  return (
    <footer className="border-t py-10">
      <Container className="space-y-6">
        <div className="flex flex-col justify-between gap-6 sm:flex-row">
          <div className="space-y-1">
            <p className="font-bold">{landingContent.brand}</p>
            <p className="text-sm text-muted-foreground">{landingContent.deliveryNotice}</p>
          </div>
          <nav aria-label="Policies">
            <ul className="flex list-none flex-col gap-2 p-0 text-sm sm:flex-row sm:gap-6">
              {landingContent.policies.map((policy) => (
                <li key={policy.href}>
                  <Link href={policy.href} className="text-muted-foreground hover:text-foreground">
                    {policy.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <Separator />
        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} {landingContent.brand}. AI-generated models are approximate;
          printed objects may vary from on-screen previews.
        </p>
      </Container>
    </footer>
  )
}
