import { describe, expect, it } from "vitest"

import type { Role } from "@/src/adapters/auth"
import { decideRoute, type RouteDecision } from "@/src/lib/routeGuard"

const anon = null
const customer = { role: "customer" as Role }
const operator = { role: "operator" as Role }
const admin = { role: "admin" as Role }

describe("decideRoute matrix", () => {
  const cases: Array<[string, { role: Role } | null, RouteDecision]> = [
    // ops: 404 unless operator/admin
    ["/ops", anon, { kind: "not_found" }],
    ["/ops", customer, { kind: "not_found" }],
    ["/ops", operator, { kind: "allow" }],
    ["/ops", admin, { kind: "allow" }],
    ["/ops/orders/ord_1", customer, { kind: "not_found" }],
    ["/ops/orders/ord_1", operator, { kind: "allow" }],
    // studio: session required
    ["/projects", anon, { kind: "redirect", to: "/login?next=%2Fprojects" }],
    ["/projects", customer, { kind: "allow" }],
    ["/projects/proj_1", anon, { kind: "redirect", to: "/login?next=%2Fprojects%2Fproj_1" }],
    ["/orders", anon, { kind: "redirect", to: "/login?next=%2Forders" }],
    ["/orders/ord_9", customer, { kind: "allow" }],
    ["/checkout/qt_1", anon, { kind: "redirect", to: "/login?next=%2Fcheckout%2Fqt_1" }],
    ["/profile", anon, { kind: "redirect", to: "/login?next=%2Fprofile" }],
    ["/profile", operator, { kind: "allow" }],
    // auth pages: skip when signed in
    ["/login", anon, { kind: "allow" }],
    ["/login", customer, { kind: "redirect", to: "/projects" }],
    ["/sign-up", anon, { kind: "allow" }],
    ["/sign-up", admin, { kind: "redirect", to: "/projects" }],
    // public
    ["/", anon, { kind: "allow" }],
    ["/", customer, { kind: "allow" }],
    ["/reset-password", anon, { kind: "allow" }],
    // prefix confusion guards
    ["/projectsfoo", anon, { kind: "allow" }],
    ["/opsfoo", anon, { kind: "allow" }],
  ]

  it.each(cases)("%s as %o → %o", (pathname, user, expected) => {
    expect(decideRoute(pathname, user)).toEqual(expected)
  })
})
