import { updatePasswordAction } from "@/app/(auth)/actions"
import { UpdatePasswordForm } from "@/src/components/auth/forms"

export default function UpdatePasswordPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <UpdatePasswordForm action={updatePasswordAction} />
    </div>
  )
}
