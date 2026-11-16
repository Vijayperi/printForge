import type * as React from "react"

import { cn } from "@/src/lib/utils"

export function Container({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="container"
      className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6", className)}
      {...props}
    />
  )
}

export function Section({ className, ...props }: React.ComponentProps<"section">) {
  return <section data-slot="section" className={cn("py-16 sm:py-20", className)} {...props} />
}

export function PageHeader({
  title,
  description,
  className,
  ...props
}: React.ComponentProps<"div"> & { title: string; description?: string }) {
  return (
    <div data-slot="page-header" className={cn("space-y-2", className)} {...props}>
      <h2 className="text-3xl font-semibold tracking-tight">{title}</h2>
      {description === undefined ? null : (
        <p className="max-w-2xl text-muted-foreground">{description}</p>
      )}
    </div>
  )
}
