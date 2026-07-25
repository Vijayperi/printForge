import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { axe } from "vitest-axe"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))

import {
  jobRequest,
  JOB_ACTION_LABELS,
  PrintJobPanel,
  type PrintJobView,
} from "@/src/components/ops/print-job-panel"
import { MAX_PRINT_ATTEMPTS, printJobControls, type PrintJobControls } from "@/src/domain/ops/production"
import type { PrintJobRow } from "@/src/domain/types"

const PRINTERS = [
  { id: "prn_1", name: "Forge One" },
  { id: "prn_2", name: "Forge Two" },
]

function view(overrides: Partial<PrintJobView> = {}): PrintJobView {
  return {
    id: "pj_1",
    status: "pending",
    attempt: 1,
    printerName: null,
    failureReason: null,
    ...overrides,
  }
}

function row(overrides: Partial<PrintJobRow> = {}): PrintJobRow {
  return {
    id: "pj_1",
    order_id: "ord_1",
    printer_id: null,
    status: "pending",
    gcode_asset_id: null,
    slice_json: null,
    gateway_job_ref: null,
    failure_reason: null,
    attempt: 1,
    created_at: "2026-07-25T00:00:00Z",
    updated_at: "2026-07-25T00:00:00Z",
    ...overrides,
  }
}

/** Controls exactly as the page computes them, so the test cannot drift from the domain. */
function controlsFor(orderStatus: string, jobs: PrintJobRow[]): PrintJobControls {
  return printJobControls({ status: orderStatus, payment_status: "paid" }, jobs)
}

function renderPanel(
  opts: {
    latest?: PrintJobView | null
    controls?: PrintJobControls
    printers?: { id: string; name: string }[]
    nextAttempt?: number
  } = {}
) {
  return render(
    <PrintJobPanel
      orderId="ord_1"
      latest={opts.latest === undefined ? null : opts.latest}
      printers={opts.printers ?? PRINTERS}
      controls={opts.controls ?? controlsFor("production_queued", [])}
      nextAttempt={opts.nextAttempt ?? 1}
    />
  )
}

const fetchMock = vi.fn()

beforeEach(() => {
  refresh.mockClear()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("jobRequest", () => {
  const ctx = { orderId: "ord_1", jobId: "pj_1", printerId: "prn_2", reason: "because" }

  it.each([
    ["create", "/api/ops/orders/ord_1/print-jobs", { reason: "because" }],
    ["assign", "/api/ops/print-jobs/pj_1/assign", { printerId: "prn_2", reason: "because" }],
    ["retry", "/api/ops/print-jobs/pj_1/retry", { reason: "because" }],
    ["cancel", "/api/ops/print-jobs/pj_1/cancel", { reason: "because" }],
    ["qc_pass", "/api/ops/print-jobs/pj_1/qc", { outcome: "pass", reason: "because" }],
    ["qc_fail", "/api/ops/print-jobs/pj_1/qc", { outcome: "fail", reason: "because" }],
  ] as const)("posts %s to %s", (action, url, body) => {
    expect(jobRequest(action, ctx)).toEqual({ url, body })
  })
})

describe("PrintJobPanel", () => {
  it("says nothing is queued before the first job", () => {
    renderPanel()
    expect(screen.getByText(/no print has been queued/i)).toBeInTheDocument()
  })

  it("shows the attempt counter, status and printer of the latest job", () => {
    renderPanel({
      latest: view({ status: "printing", attempt: 2, printerName: "Forge One" }),
      controls: controlsFor("production_queued", [row({ status: "printing", attempt: 2 })]),
    })
    expect(screen.getByText(`Print 2/${MAX_PRINT_ATTEMPTS}`)).toBeInTheDocument()
    expect(screen.getByText("Printing")).toBeInTheDocument()
    expect(screen.getByText("Forge One")).toBeInTheDocument()
  })

  it("shows a failure reason when the print failed", () => {
    renderPanel({
      latest: view({ status: "failed", failureReason: "filament ran out" }),
      controls: controlsFor("production_queued", [row({ status: "failed" })]),
    })
    expect(screen.getByText("filament ran out")).toBeInTheDocument()
  })

  it("offers the printer picker only while the job is assignable", () => {
    renderPanel({
      latest: view(),
      controls: controlsFor("production_queued", [row({ status: "pending" })]),
    })
    expect(screen.getByLabelText("Printer")).toBeInTheDocument()

    renderPanel({
      latest: view({ status: "printing" }),
      controls: controlsFor("production_queued", [row({ status: "printing" })]),
    })
    expect(screen.getAllByLabelText("Printer")).toHaveLength(1)
  })

  it("draws the release control disabled, with the reason it is inert", () => {
    renderPanel({
      latest: view(),
      controls: controlsFor("production_queued", [row({ status: "pending" })]),
    })
    const release = screen.getByRole("button", { name: /release to printer/i })
    expect(release).toBeDisabled()
    const described = release.getAttribute("aria-describedby")
    expect(described).not.toBeNull()
    expect(document.getElementById(described as string)?.textContent).toMatch(/printer gateway/i)
  })

  it("disables an inapplicable control and explains why", () => {
    renderPanel({ controls: controlsFor("paid", []) })
    const create = screen.getByRole("button", { name: JOB_ACTION_LABELS.create })
    expect(create).toBeDisabled()
    expect(screen.getByText(/not queued for production/i)).toBeInTheDocument()
  })

  it("keeps the reason mandatory before an action can be confirmed", async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole("button", { name: JOB_ACTION_LABELS.create }))
    const confirm = await screen.findByRole("button", { name: "Confirm" })
    expect(confirm).toBeDisabled()

    await user.type(screen.getByLabelText(/reason/i), "first print")
    expect(confirm).toBeEnabled()
  })

  it("tells the operator which print they are about to queue", async () => {
    const user = userEvent.setup()
    renderPanel({ nextAttempt: 2 })
    await user.click(screen.getByRole("button", { name: JOB_ACTION_LABELS.create }))
    expect(
      await screen.findByText(`This will be print 2 of ${MAX_PRINT_ATTEMPTS} for this order.`)
    ).toBeInTheDocument()
  })

  it("creates a print job and refreshes", async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole("button", { name: JOB_ACTION_LABELS.create }))
    await user.type(await screen.findByLabelText(/reason/i), "first print")
    await user.click(screen.getByRole("button", { name: "Confirm" }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ops/orders/ord_1/print-jobs",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ reason: "first print" }) })
    )
  })

  it("assigns the printer chosen in the picker", async () => {
    const user = userEvent.setup()
    renderPanel({
      latest: view(),
      controls: controlsFor("production_queued", [row({ status: "pending" })]),
    })
    await user.selectOptions(screen.getByLabelText("Printer"), "prn_2")
    await user.click(screen.getByRole("button", { name: JOB_ACTION_LABELS.assign }))
    await user.type(await screen.findByLabelText(/reason/i), "closest machine")
    await user.click(screen.getByRole("button", { name: "Confirm" }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ops/print-jobs/pj_1/assign",
      expect.objectContaining({
        body: JSON.stringify({ printerId: "prn_2", reason: "closest machine" }),
      })
    )
  })

  it("records a quality-check pass", async () => {
    const user = userEvent.setup()
    renderPanel({
      latest: view({ status: "completed" }),
      controls: controlsFor("quality_check", [row({ status: "completed" })]),
    })
    await user.click(screen.getByRole("button", { name: JOB_ACTION_LABELS.qc_pass }))
    await user.type(await screen.findByLabelText(/reason/i), "looks good")
    await user.click(screen.getByRole("button", { name: "Confirm" }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ops/print-jobs/pj_1/qc",
      expect.objectContaining({ body: JSON.stringify({ outcome: "pass", reason: "looks good" }) })
    )
  })

  it("surfaces the server's reason for a refused action and stays open", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: "this order has not been paid" } }),
    })
    renderPanel()
    await user.click(screen.getByRole("button", { name: JOB_ACTION_LABELS.create }))
    await user.type(await screen.findByLabelText(/reason/i), "try anyway")
    await user.click(screen.getByRole("button", { name: "Confirm" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("this order has not been paid")
    expect(refresh).not.toHaveBeenCalled()
  })

  it("falls back to a generic message when the error body has no message", async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    renderPanel()
    await user.click(screen.getByRole("button", { name: JOB_ACTION_LABELS.create }))
    await user.type(await screen.findByLabelText(/reason/i), "try anyway")
    await user.click(screen.getByRole("button", { name: "Confirm" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be applied")
  })

  it("closes the dialog and drops the draft reason on cancel", async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole("button", { name: JOB_ACTION_LABELS.create }))
    await user.type(await screen.findByLabelText(/reason/i), "never mind")
    await user.click(screen.getByRole("button", { name: "Cancel" }))

    await waitFor(() => expect(screen.queryByLabelText(/reason/i)).not.toBeInTheDocument())
    await user.click(screen.getByRole("button", { name: JOB_ACTION_LABELS.create }))
    expect(await screen.findByLabelText(/reason/i)).toHaveValue("")
  })

  it("closes when the dialog is dismissed from outside", async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole("button", { name: JOB_ACTION_LABELS.create }))
    expect(await screen.findByLabelText(/reason/i)).toBeInTheDocument()
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByLabelText(/reason/i)).not.toBeInTheDocument())
  })

  it("still renders with no printers configured", () => {
    renderPanel({
      latest: view(),
      controls: controlsFor("production_queued", [row({ status: "pending" })]),
      printers: [],
    })
    expect(screen.getByLabelText("Printer")).toBeInTheDocument()
  })

  it("has no accessibility violations", async () => {
    const { container } = renderPanel({
      latest: view({ status: "failed", failureReason: "clog", attempt: 2 }),
      controls: controlsFor("production_queued", [row({ status: "failed", attempt: 2 })]),
    })
    expect(await axe(container)).toHaveNoViolations()
  })
})
