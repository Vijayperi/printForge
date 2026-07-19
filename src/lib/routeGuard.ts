import type { Role } from "@/src/adapters/auth"

export type RouteDecision =
  | { kind: "allow" }
  | { kind: "redirect"; to: string }
  | { kind: "not_found" }

const STUDIO_PREFIXES = ["/projects", "/orders", "/checkout"] as const

function isStudioPath(pathname: string): boolean {
  return (
    pathname === "/profile" ||
    STUDIO_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  )
}

function isOpsPath(pathname: string): boolean {
  return pathname === "/ops" || pathname.startsWith("/ops/")
}

/**
 * Pure routing decision per plan §6-S3: studio requires a session (redirect to
 * login with a return target); ops requires operator/admin and answers 404 to
 * everyone else so its existence is not revealed; signed-in users skip the
 * auth pages.
 */
export function decideRoute(pathname: string, user: { role: Role } | null): RouteDecision {
  if (isOpsPath(pathname)) {
    if (user !== null && (user.role === "operator" || user.role === "admin")) {
      return { kind: "allow" }
    }
    return { kind: "not_found" }
  }
  if (isStudioPath(pathname)) {
    if (user === null) {
      return { kind: "redirect", to: `/login?next=${encodeURIComponent(pathname)}` }
    }
    return { kind: "allow" }
  }
  if ((pathname === "/login" || pathname === "/sign-up") && user !== null) {
    return { kind: "redirect", to: "/projects" }
  }
  return { kind: "allow" }
}
