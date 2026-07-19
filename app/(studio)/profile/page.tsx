import Link from "next/link"
import { redirect } from "next/navigation"

import { updateProfileAction } from "@/app/(auth)/actions"
import { getAuthGateway } from "@/src/adapters/auth/factory"
import { ProfileForm } from "@/src/components/auth/forms"
import { PageHeader } from "@/src/components/layout/primitives"
import { Badge } from "@/src/components/ui/badge"

export default async function ProfilePage() {
  const gateway = await getAuthGateway()
  const user = await gateway.getUser()
  if (!user.ok || user.value === null) {
    redirect("/login")
  }
  return (
    <div className="max-w-md space-y-6">
      <PageHeader title="Your profile" />
      <dl className="space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Email:</dt>
          <dd>{user.value.email}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-muted-foreground">Role:</dt>
          <dd>
            <Badge variant="secondary">{user.value.role}</Badge>
          </dd>
        </div>
      </dl>
      <ProfileForm action={updateProfileAction} initialName={user.value.name} />
      <p className="text-sm text-muted-foreground">
        Need a new password?{" "}
        <Link href="/reset-password/update" className="underline hover:text-foreground">
          Change password
        </Link>
      </p>
    </div>
  )
}
