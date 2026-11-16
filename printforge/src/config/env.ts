import { z } from "zod"

import { appError } from "@/src/lib/errors"
import { err, ok, type Result } from "@/src/lib/result"

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url().default("http://localhost:3000"),

    // Supabase — required from Session 3 onward; optional so earlier sessions run env-free.
    NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),

    GENERATION_PROVIDER: z.enum(["mock", "meshy"]).default("mock"),
    MESHY_API_KEY: z.string().min(1).optional(),

    PAYMENT_PROVIDER: z.enum(["mock", "dodo"]).default("mock"),
    DODO_API_KEY: z.string().min(1).optional(),
    DODO_WEBHOOK_SECRET: z.string().min(1).optional(),
    DODO_PRODUCT_ID: z.string().min(1).optional(),
    DODO_ENV: z.enum(["test_mode", "live_mode"]).default("test_mode"),

    SLICER: z.enum(["mock", "prusa"]).default("mock"),
    PRUSA_SLICER_PATH: z.string().min(1).optional(),

    PRINTER_GATEWAY: z.enum(["mock", "octoprint"]).default("mock"),
    PRINTER_GATEWAY_CONFIG: z.string().min(1).optional(),

    EMAIL: z.enum(["mock", "resend"]).default("mock"),
    RESEND_API_KEY: z.string().min(1).optional(),
    // Routing, not copy: which identity we send as and which inbox ops alerts
    // land in. OWNER DECISION REQUIRED — both need a verified sending domain.
    EMAIL_FROM: z.string().min(1).default("PrintForge <orders@printforge.example>"),
    OPS_ALERT_EMAIL: z.email().default("ops@printforge.example"),
  })
  .superRefine((env, ctx) => {
    if (env.GENERATION_PROVIDER === "meshy" && env.MESHY_API_KEY === undefined) {
      ctx.addIssue({ code: "custom", path: ["MESHY_API_KEY"], message: "required when GENERATION_PROVIDER=meshy" })
    }
    if (env.PAYMENT_PROVIDER === "dodo") {
      for (const key of ["DODO_API_KEY", "DODO_WEBHOOK_SECRET", "DODO_PRODUCT_ID"] as const) {
        if (env[key] === undefined) {
          ctx.addIssue({ code: "custom", path: [key], message: "required when PAYMENT_PROVIDER=dodo" })
        }
      }
    }
    if (env.SLICER === "prusa" && env.PRUSA_SLICER_PATH === undefined) {
      ctx.addIssue({ code: "custom", path: ["PRUSA_SLICER_PATH"], message: "required when SLICER=prusa" })
    }
    if (env.PRINTER_GATEWAY === "octoprint") {
      if (env.PRINTER_GATEWAY_CONFIG === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["PRINTER_GATEWAY_CONFIG"],
          message: "required when PRINTER_GATEWAY=octoprint",
        })
      } else {
        try {
          JSON.parse(env.PRINTER_GATEWAY_CONFIG)
        } catch {
          ctx.addIssue({ code: "custom", path: ["PRINTER_GATEWAY_CONFIG"], message: "must be valid JSON" })
        }
      }
    }
    if (env.EMAIL === "resend") {
      if (env.RESEND_API_KEY === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["RESEND_API_KEY"],
          message: "required when EMAIL=resend",
        })
      }
      if (env.EMAIL_FROM.includes("printforge.example")) {
        // The default is a placeholder domain no ESP will ever accept; failing
        // at boot beats every send failing one at a time in the worker.
        ctx.addIssue({
          code: "custom",
          path: ["EMAIL_FROM"],
          message: "must be a verified sending address when EMAIL=resend",
        })
      }
    }
  })

export type Env = z.infer<typeof envSchema>

export function loadEnv(raw: Record<string, string | undefined>): Result<Env> {
  const parsed = envSchema.safeParse(raw)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    return err(appError("validation", `invalid environment: ${detail}`))
  }
  return ok(parsed.data)
}

let cached: Env | null = null

export function getEnv(): Env {
  if (cached === null) {
    const result = loadEnv(process.env)
    if (!result.ok) throw result.error
    cached = result.value
  }
  return cached
}

/** Test-only: clears the memoized environment. */
export function resetEnvCache(): void {
  cached = null
}
