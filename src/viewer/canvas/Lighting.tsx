"use client"

/** Self-contained studio-style lighting (no external HDR/CDN assets). */
export function Lighting() {
  return (
    <>
      <ambientLight intensity={0.6} />
      <hemisphereLight args={["#ffffff", "#444455", 0.5]} />
      <directionalLight position={[5, 10, 7]} intensity={1.2} castShadow />
      <directionalLight position={[-6, 4, -5]} intensity={0.4} />
    </>
  )
}
