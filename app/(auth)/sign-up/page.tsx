import { signUpAction } from "@/app/(auth)/actions"
import { SignUpForm } from "@/src/components/auth/forms"

export default function SignUpPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Create your account</h1>
      <SignUpForm action={signUpAction} />
    </div>
  )
}
