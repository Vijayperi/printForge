"use client"

import { OrbitControls } from "@react-three/drei"
import { useEffect, useRef, type ComponentRef } from "react"

import { resetControls } from "@/src/viewer/canvas/orbitReset"

export interface OrbitRigProps {
  reducedMotion: boolean
  resetRequested: boolean
  onResetHandled: () => void
}

export function OrbitRig({ reducedMotion, resetRequested, onResetHandled }: OrbitRigProps) {
  const ref = useRef<ComponentRef<typeof OrbitControls> | null>(null)

  useEffect(() => {
    if (!resetRequested) return
    resetControls(ref.current, onResetHandled)
  }, [resetRequested, onResetHandled])

  return (
    <OrbitControls
      ref={ref}
      makeDefault
      enablePan
      enableZoom
      enableRotate
      enableDamping={!reducedMotion}
      autoRotate={false}
    />
  )
}
