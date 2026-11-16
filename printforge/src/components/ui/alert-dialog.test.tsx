import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { axe } from "vitest-axe"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/src/components/ui/alert-dialog"

describe("AlertDialog", () => {
  it("renders only its trigger when closed", () => {
    render(
      <AlertDialog>
        <AlertDialogTrigger>Delete</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Hidden</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>
    )
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument()
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  })

  it("renders every part when open with default variants and size", () => {
    render(
      <AlertDialog open>
        <AlertDialogTrigger>Trigger</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <span>icon</span>
            </AlertDialogMedia>
            <AlertDialogTitle>Archive project?</AlertDialogTitle>
            <AlertDialogDescription>This can be undone later.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText("Archive project?")).toBeInTheDocument()
    expect(within(dialog).getByText("This can be undone later.")).toBeInTheDocument()
    expect(within(dialog).getByText("icon")).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveAttribute(
      "data-variant",
      "outline"
    )
    expect(within(dialog).getByRole("button", { name: "Confirm" })).toHaveAttribute(
      "data-variant",
      "default"
    )
  })

  it("supports the small size and custom action/cancel variants with classNames", () => {
    render(
      <AlertDialog open>
        <AlertDialogContent size="sm" className="content-x">
          <AlertDialogHeader className="header-x">
            <AlertDialogTitle className="title-x">Small</AlertDialogTitle>
            <AlertDialogDescription className="desc-x">Body</AlertDialogDescription>
            <AlertDialogMedia className="media-x">m</AlertDialogMedia>
          </AlertDialogHeader>
          <AlertDialogFooter className="footer-x">
            <AlertDialogCancel variant="ghost" size="sm" className="cancel-x">
              Keep
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" size="sm" className="action-x">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
    const dialog = screen.getByRole("alertdialog")
    expect(dialog).toHaveAttribute("data-size", "sm")
    expect(dialog).toHaveClass("content-x")
    expect(within(dialog).getByText("Small")).toHaveClass("title-x")
    expect(within(dialog).getByText("Body")).toHaveClass("desc-x")
    expect(within(dialog).getByText("m")).toHaveClass("media-x")
    const keep = within(dialog).getByRole("button", { name: "Keep" })
    expect(keep).toHaveAttribute("data-variant", "ghost")
    expect(keep).toHaveAttribute("data-size", "sm")
    const remove = within(dialog).getByRole("button", { name: "Remove" })
    expect(remove).toHaveAttribute("data-variant", "destructive")
  })

  it("has no accessibility violations when open", async () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Accessible</AlertDialogTitle>
            <AlertDialogDescription>Body</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
    expect(await axe(screen.getByRole("alertdialog"))).toHaveNoViolations()
  })
})
