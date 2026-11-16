import { loginAction } from "@/app/(auth)/actions"
import { LoginForm } from "@/src/components/auth/forms"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const next = typeof params["next"] === "string" ? params["next"] : undefined
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Log in</h1>
      <LoginForm action={loginAction} next={next} />
    </div>
  )
}
