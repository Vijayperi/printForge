import Link from "next/link"
import { notFound } from "next/navigation"

import { getAuthGateway } from "@/src/adapters/auth/factory"
import { Container } from "@/src/components/layout/primitives"

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const gateway = await getAuthGateway()
  const user = await gateway.getUser()
  if (!user.ok || user.value === null || user.value.role === "customer") {
    notFound()
  }
  return (
    <div className="min-h-screen">
      <header className="border-b bg-muted/40">
        <Container className="flex h-12 items-center justify-between text-sm font-medium">
          <span className="flex items-center gap-4">
            <Link href="/ops" className="hover:underline">
              Orders
            </Link>
            <Link href="/ops/reviews" className="hover:underline">
              Review queue
            </Link>
          </span>
          <span className="text-muted-foreground">
            PrintForge Operations — signed in as {user.value.email} ({user.value.role})
          </span>
        </Container>
      </header>
      <main>
        <Container className="py-8">{children}</Container>
      </main>
    </div>
  )
}
