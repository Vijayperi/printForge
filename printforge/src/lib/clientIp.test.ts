import { describe, expect, it } from "vitest"

import { clientIpFrom, UNKNOWN_CLIENT_IP } from "@/src/lib/clientIp"

function headers(entries: Record<string, string>) {
  return { get: (name: string) => entries[name] ?? null }
}

describe("clientIpFrom", () => {
  it("takes the original client from the front of x-forwarded-for", () => {
    expect(clientIpFrom(headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" })))
      .toBe("203.0.113.7")
  })

  it("trims the whitespace proxies leave behind", () => {
    expect(clientIpFrom(headers({ "x-forwarded-for": "  203.0.113.7 , 70.41.3.18" }))).toBe(
      "203.0.113.7"
    )
  })

  it("handles a single-hop header", () => {
    expect(clientIpFrom(headers({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7")
  })

  it("falls back to x-real-ip", () => {
    expect(clientIpFrom(headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4")
  })

  it("prefers x-forwarded-for over x-real-ip", () => {
    const both = headers({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "198.51.100.4" })
    expect(clientIpFrom(both)).toBe("203.0.113.7")
  })

  it.each([
    ["no headers at all", {}],
    ["an empty forwarded header", { "x-forwarded-for": "" }],
    ["a forwarded header of only separators", { "x-forwarded-for": " , " }],
    ["an empty real-ip header", { "x-real-ip": "   " }],
  ])("reports %s as unknown", (_label, entries) => {
    expect(clientIpFrom(headers(entries))).toBe(UNKNOWN_CLIENT_IP)
  })
})
