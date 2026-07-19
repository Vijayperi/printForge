import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import type { Role } from "@/src/adapters/auth"
import { decideRoute } from "@/src/lib/routeGuard"

/**
 * Early session/role guard for real (Supabase) mode. In mock mode the layouts
 * perform the authoritative server-side checks; this proxy simply passes
 * through. Logic lives in src/lib/routeGuard.ts (fully covered); this file is
 * thin request plumbing.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  let response = NextResponse.next({ request })
  if (url === undefined || key === undefined) {
    return response
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  const { data } = await supabase.auth.getUser()
  let user: { role: Role } | null = null
  if (data.user !== null) {
    if (request.nextUrl.pathname.startsWith("/ops")) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", data.user.id)
        .maybeSingle()
      user = { role: (profile?.role ?? "customer") as Role }
    } else {
      user = { role: "customer" }
    }
  }

  const decision = decideRoute(request.nextUrl.pathname, user)
  if (decision.kind === "redirect") {
    return NextResponse.redirect(new URL(decision.to, request.url))
  }
  if (decision.kind === "not_found") {
    return NextResponse.rewrite(new URL("/not-found-404", request.url))
  }
  return response
}

export const config = {
  matcher: [
    "/projects/:path*",
    "/projects",
    "/orders/:path*",
    "/orders",
    "/checkout/:path*",
    "/profile",
    "/ops/:path*",
    "/ops",
    "/login",
    "/sign-up",
  ],
}
