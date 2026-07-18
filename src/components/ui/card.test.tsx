import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { axe } from "vitest-axe"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/src/components/ui/card"

function renderFullCard() {
  return render(
    <Card data-testid="card">
      <CardHeader>
        <CardTitle>Title text</CardTitle>
        <CardDescription>Description text</CardDescription>
        <CardAction>
          <button type="button">Action</button>
        </CardAction>
      </CardHeader>
      <CardContent>Body content</CardContent>
      <CardFooter>Footer content</CardFooter>
    </Card>
  )
}

describe("Card", () => {
  it("renders every sub-component with its data-slot", () => {
    renderFullCard()
    expect(screen.getByTestId("card")).toHaveAttribute("data-slot", "card")
    expect(screen.getByText("Title text")).toHaveAttribute("data-slot", "card-title")
    expect(screen.getByText("Description text")).toHaveAttribute("data-slot", "card-description")
    expect(screen.getByText("Body content")).toHaveAttribute("data-slot", "card-content")
    expect(screen.getByText("Footer content")).toHaveAttribute("data-slot", "card-footer")
    expect(screen.getByRole("button", { name: "Action" }).parentElement).toHaveAttribute(
      "data-slot",
      "card-action"
    )
    expect(screen.getByText("Title text").parentElement).toHaveAttribute("data-slot", "card-header")
  })

  it("merges custom classNames on every sub-component", () => {
    render(
      <Card className="c1">
        <CardHeader className="c2">
          <CardTitle className="c3">T</CardTitle>
          <CardDescription className="c4">D</CardDescription>
          <CardAction className="c5">A</CardAction>
        </CardHeader>
        <CardContent className="c6">B</CardContent>
        <CardFooter className="c7">F</CardFooter>
      </Card>
    )
    for (const [text, cls] of [
      ["T", "c3"],
      ["D", "c4"],
      ["A", "c5"],
      ["B", "c6"],
      ["F", "c7"],
    ] as const) {
      expect(screen.getByText(text)).toHaveClass(cls)
    }
  })

  it("has no accessibility violations", async () => {
    const { container } = renderFullCard()
    expect(await axe(container)).toHaveNoViolations()
  })
})
