import { cn } from "@/src/lib/utils"

export interface TextureDisclaimerProps {
  className?: string
}

export function TextureDisclaimer({ className }: TextureDisclaimerProps) {
  return (
    <p
      data-slot="texture-disclaimer"
      className={cn("text-xs text-muted-foreground", className)}
    >
      On-screen surface textures are a preview — an FDM print reproduces the shape in a single
      filament colour, not screen textures.
    </p>
  )
}
