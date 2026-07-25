import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { axe } from "vitest-axe"

import { formatSeenAt, PrintersTable } from "@/src/components/ops/printers-table"
import type { FleetRow } from "@/src/domain/ops/fleet"

function fleetRow(overrides: Partial<FleetRow> = {}): FleetRow {
  return {
    printerId: "prn_1",
    name: "Bay 1 — Prusa MK4",
    state: "idle",
    stateLabel: "Idle",
    needsAttention: false,
    lastSeenAt: "2026-07-26T09:30:00Z",
    job: null,
    ...overrides,
  }
}

describe("formatSeenAt", () => {
  it("formats in UTC so every operator reads the same clock", () => {
    expect(formatSeenAt("2026-07-26T09:30:00Z")).toBe("26 Jul 2026, 09:30")
  })

  it.each([
    ["a machine never polled", null],
    ["an unparseable timestamp", "not a date"],
  ])("says so for %s", (_label, value) => {
    expect(formatSeenAt(value)).toBe("Never")
  })
})

describe("PrintersTable", () => {
  it("says so when no printers are configured", () => {
    render(<PrintersTable printers={[]} />)
    expect(screen.getByText(/no printers are configured/i)).toBeInTheDocument()
  })

  it("shows each machine's state and when it last reported", () => {
    render(<PrintersTable printers={[fleetRow()]} />)
    expect(screen.getByRole("rowheader", { name: "Bay 1 — Prusa MK4" })).toBeInTheDocument()
    expect(screen.getByText("Idle")).toBeInTheDocument()
    expect(screen.getByText("26 Jul 2026, 09:30")).toBeInTheDocument()
    expect(screen.getByText(/nothing loaded/i)).toBeInTheDocument()
  })

  it("links a busy machine to the order it is holding up", () => {
    render(
      <PrintersTable
        printers={[
          fleetRow({
            state: "busy",
            stateLabel: "Printing",
            job: { id: "pj_9", orderId: "ord_9", attempt: 2, status: "printing" },
          }),
        ]}
      />
    )
    const link = screen.getByRole("link", { name: /ord_9/ })
    expect(link).toHaveAttribute("href", "/ops/orders/ord_9")
    expect(link).toHaveTextContent("Print 2")
    expect(link).toHaveTextContent("Printing")
  })

  it("shows an unrecognized job status verbatim rather than blank", () => {
    render(
      <PrintersTable
        printers={[fleetRow({ job: { id: "pj_9", orderId: "ord_9", attempt: 1, status: "wedged" } })]}
      />
    )
    expect(screen.getByRole("link", { name: /ord_9/ })).toHaveTextContent("wedged")
  })

  it("has no accessibility violations", async () => {
    const { container } = render(
      <PrintersTable
        printers={[
          fleetRow(),
          fleetRow({
            printerId: "prn_2",
            name: "Bay 2",
            state: "error",
            stateLabel: "Error",
            needsAttention: true,
            job: { id: "pj_2", orderId: "ord_2", attempt: 1, status: "printing" },
          }),
        ]}
      />
    )
    await expect(axe(container)).resolves.toHaveNoViolations()
  })
})
