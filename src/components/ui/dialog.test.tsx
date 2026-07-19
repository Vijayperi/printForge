import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { axe } from "vitest-axe"

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/src/components/ui/dialog"

describe("Dialog", () => {
  it("renders a closed dialog as just its trigger", () => {
    render(
      <Dialog>
        <DialogTrigger>Open it</DialogTrigger>
        <DialogContent>
          <DialogTitle>Hidden</DialogTitle>
        </DialogContent>
      </Dialog>
    )
    expect(screen.getByRole("button", { name: "Open it" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("renders all parts when open, with the default close button and a footer close", () => {
    render(
      <Dialog open>
        <DialogTrigger>Trigger</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>The title</DialogTitle>
            <DialogDescription>The description</DialogDescription>
          </DialogHeader>
          <DialogClose>Body close</DialogClose>
          <DialogFooter showCloseButton>
            <button type="button">Save</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("The title")).toBeInTheDocument()
    expect(within(dialog).getByText("The description")).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Body close" })).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeInTheDocument()
    // Both the content's X and the footer's Close button are labelled "Close".
    expect(within(dialog).getAllByRole("button", { name: "Close" })).toHaveLength(2)
  })

  it("can hide the content close button and render a default footer", () => {
    render(
      <Dialog open>
        <DialogContent showCloseButton={false}>
          <DialogTitle>No X</DialogTitle>
          <DialogFooter>
            <button type="button">Only</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).queryByRole("button", { name: "Close" })).not.toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Only" })).toBeInTheDocument()
  })

  it("has no accessibility violations when open", async () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accessible</DialogTitle>
            <DialogDescription>Body</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    )
    expect(await axe(screen.getByRole("dialog"))).toHaveNoViolations()
  })
})
