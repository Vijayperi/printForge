import Link from "next/link"
import { redirect } from "next/navigation"

import { signOutAction } from "@/app/(auth)/actions"
import { getAuthGateway } from "@/src/adapters/auth/factory"
import { SignOutButton } from "@/src/components/auth/forms"
import { Container } from "@/src/components/layout/primitives"
import { landingContent } from "@/src/config/content"

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const gateway = await getAuthGateway()
  const user = await gateway.getUser()
  if (!user.ok || user.value === null) {
    redirect("/login")
  }
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <Container className="flex h-14 items-center justify-between">
          <Link href="/" className="font-bold tracking-tight">
            {landingContent.brand}
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/projects" className="text-muted-foreground hover:text-foreground">
              My projects
            </Link>
            <Link href="/profile" className="text-muted-foreground hover:text-foreground">
              {user.value.email}
            </Link>
            <SignOutButton action={signOutAction} />
          </div>
        </Container>
      </header>
      <main>
        <Container className="py-8">{children}</Container>
      </main>
    </div>
  )
}
