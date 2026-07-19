import { resetRequestAction } from "@/app/(auth)/actions"
import { ResetRequestForm } from "@/src/components/auth/forms"

export default function ResetPasswordPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <ResetRequestForm action={resetRequestAction} />
    </div>
  )
}
