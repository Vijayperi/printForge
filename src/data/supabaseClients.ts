import "server-only"

import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

import { getEnv } from "@/src/config/env"
import type { Db } from "@/src/data/db"
import { appError } from "@/src/lib/errors"

export function supabaseConfigured(): boolean {
  const env = getEnv()
  return env.NEXT_PUBLIC_SUPABASE_URL !== undefined && env.NEXT_PUBLIC_SUPABASE_ANON_KEY !== undefined
}

/**
 * Cookie-bound Supabase client for server components, server actions, and
 * route handlers. The only place an SSR Supabase client is constructed.
 */
export async function createServerSupabase() {
  const env = getEnv()
  if (env.NEXT_PUBLIC_SUPABASE_URL === undefined || env.NEXT_PUBLIC_SUPABASE_ANON_KEY === undefined) {
    throw appError("internal", "Supabase is not configured; check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY")
  }
  const cookieStore = await cookies()
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Called from a Server Component render, where cookies are read-only.
          // Safe to ignore: middleware refreshes sessions on navigation.
        }
      },
    },
  })
}

/**
 * The request-scoped, cookie-bound database handle for route handlers and
 * server components. Repositories accept this `Db`; the structural cast keeps
 * the only Supabase dependency inside the data layer.
 */
export async function getRequestDb(): Promise<Db> {
  const client = await createServerSupabase()
  return client as unknown as Db
}
