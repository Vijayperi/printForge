"use client"

import { useState } from "react"
import Link from "next/link"

import { Container } from "@/src/components/layout/primitives"
import { Button } from "@/src/components/ui/button"
import { landingContent } from "@/src/config/content"
import { cn } from "@/src/lib/utils"

const NAV_LINKS = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Examples", href: "#examples" },
  { label: "Materials", href: "#materials" },
  { label: "FAQ", href: "#faq" },
] as const

export function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <Container className="flex h-14 items-center justify-between">
        <Link href="/" className="text-lg font-bold tracking-tight">
          {landingContent.brand}
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-6 text-sm sm:flex">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="text-muted-foreground hover:text-foreground">
              {link.label}
            </a>
          ))}
          <Button asChild size="sm">
            <Link href="/projects">{landingContent.hero.primaryCta}</Link>
          </Button>
        </nav>
        <Button
          variant="ghost"
          size="sm"
          className="sm:hidden"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? "Close" : "Menu"}
        </Button>
      </Container>
      <nav
        id="mobile-nav"
        aria-label="Main mobile"
        className={cn("border-t sm:hidden", menuOpen ? "block" : "hidden")}
      >
        <Container className="flex flex-col gap-1 py-3">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-muted"
              onClick={() => setMenuOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <Button asChild size="sm" className="mt-2">
            <Link href="/projects">{landingContent.hero.primaryCta}</Link>
          </Button>
        </Container>
      </nav>
    </header>
  )
}
