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
        <Container className="flex h-12 items-center text-sm font-medium">
          PrintForge Operations — signed in as {user.value.email} ({user.value.role})
        </Container>
      </header>
      <main>
        <Container className="py-8">{children}</Container>
      </main>
    </div>
  )
}
