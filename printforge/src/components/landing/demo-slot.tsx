"use client"

import dynamic from "next/dynamic"
import { useCallback, useRef, useState } from "react"

import { Container, Section } from "@/src/components/layout/primitives"

function DemoPlaceholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center px-6 text-center text-muted-foreground">
      {children}
    </div>
  )
}

export function DemoLoadingFallback() {
  return <DemoPlaceholder>Loading 3D preview…</DemoPlaceholder>
}

export function loadViewerWorkspace() {
  return import("@/src/viewer/ViewerWorkspace").then((m) => m.ViewerWorkspace)
}

// Code-split the 3D workspace (and three.js) out of the initial bundle; it
// loads only when the demo scrolls into view.
const LazyViewer = dynamic(loadViewerWorkspace, { ssr: false, loading: DemoLoadingFallback })

export function DemoSlot() {
  const [visible, setVisible] = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)

  const setNode = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    if (node === null || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true)
    })
    observer.observe(node)
    observerRef.current = observer
  }, [])

  return (
    <Section id="demo" aria-label="3D preview demo" className="py-8">
      <Container>
        <div
          ref={setNode}
          className="aspect-video w-full overflow-hidden rounded-2xl border bg-gradient-to-br from-muted to-secondary"
        >
          {visible ? (
            <LazyViewer url="/samples/cube.glb" projectTitle="Sample model" />
          ) : (
            <DemoPlaceholder>
              Interactive 3D preview — rotate, zoom, and inspect your model right in the browser.
            </DemoPlaceholder>
          )}
        </div>
      </Container>
    </Section>
  )
}
