/**
 * All owner-facing marketing copy and catalog-ish display data.
 * Session 2 scope: landing page only. Later sessions extend this file
 * (moderation wordlists, policy text, email copy).
 */

import type { FindingKind, Verdict } from "@/src/domain/types"

export interface FaqEntry {
  question: string
  answer: string
}

export interface ExampleObject {
  title: string
  useCase: string
  /** Tailwind gradient classes for the placeholder tile until real photos exist. */
  tileClass: string
}

export interface MaterialSummary {
  name: string
  description: string
  colorHexes: string[]
}

export const landingContent = {
  brand: "PrintForge", // OWNER DECISION REQUIRED: final brand name and visual identity
  hero: {
    headline: "Describe it. See it. We print it.",
    subheadline:
      "Tell us what you want to create. Our AI turns your words into a 3D model you can inspect, customise, and have delivered to your door.",
    promptPlaceholder: "What would you like to create?",
    primaryCta: "Start creating",
    secondaryCta: "See examples",
  },
  steps: [
    {
      title: "Create",
      description: "Describe your idea in plain language. Watch it become a 3D model in minutes.",
    },
    {
      title: "Preview",
      description:
        "Rotate it, zoom in, pick size, material, and colour — and see exactly what it costs.",
    },
    {
      title: "Delivered",
      description: "We print it on professional FDM printers, quality-check it, and ship it to you.",
    },
  ],
  examples: [
    {
      title: "Desk organiser",
      useCase: "A pen-and-cable tidy shaped to your desk",
      tileClass: "from-orange-200 to-amber-100",
    },
    {
      title: "Custom figurine",
      useCase: "A one-of-a-kind gift from a description",
      tileClass: "from-rose-200 to-orange-100",
    },
    {
      title: "Planter",
      useCase: "A geometric planter for succulents",
      tileClass: "from-emerald-200 to-teal-100",
    },
    {
      title: "Phone stand",
      useCase: "An everyday stand sized for your phone",
      tileClass: "from-sky-200 to-indigo-100",
    },
  ] satisfies ExampleObject[],
  materials: [
    {
      name: "PLA",
      description: "Crisp detail and vivid colours. Great for decorative and everyday objects.",
      colorHexes: ["#e11d48", "#f97316", "#facc15", "#22c55e", "#3b82f6", "#111827", "#f9fafb"],
    },
    {
      name: "PETG",
      description: "Tougher and more heat-resistant. Suited to functional parts.",
      colorHexes: ["#0ea5e9", "#111827", "#f9fafb"],
    },
  ] satisfies MaterialSummary[], // OWNER DECISION REQUIRED: actual material catalog and stocked colours
  pricing: {
    startingPriceMinor: 49_900, // OWNER DECISION REQUIRED: real starting price (paise)
    note: "Final price depends on size, material, and print time — you see the full breakdown before paying.",
  },
  faqs: [
    {
      question: "Do I need any design or CAD skills?",
      answer:
        "No. You describe the object in plain language and our AI builds the 3D model. You can also upload your own STL file if you already have one.",
    },
    {
      question: "Will the printed object look exactly like the preview?",
      answer:
        "Shape and proportions, yes. On-screen surface textures are a visual preview — an FDM print has fine layer lines and a single filament colour per print.",
    },
    {
      question: "What if my design can't be printed?",
      answer:
        "Every model goes through automated printability checks before you pay. If something needs attention, we tell you exactly what — and our team reviews anything borderline.",
    },
    {
      question: "Where do you deliver?",
      answer: "We currently deliver across India. Shipping cost and timing are shown in your quote.", // OWNER DECISION REQUIRED: launch geography
    },
    {
      question: "Can I cancel or get a refund?",
      answer:
        "You can cancel before production starts for a full refund. If we find a manufacturing issue after you order, we re-quote or refund you.", // OWNER DECISION REQUIRED: final refund policy
    },
  ] satisfies FaqEntry[],
  deliveryNotice: "Currently delivering across India.", // OWNER DECISION REQUIRED
  policies: [
    { label: "Terms of service", href: "/policies/terms" },
    { label: "Privacy policy", href: "/policies/privacy" },
    { label: "Refunds & cancellations", href: "/policies/refunds" },
    { label: "Acceptable use", href: "/policies/acceptable-use" },
  ], // OWNER DECISION REQUIRED: legal text for these pages
} as const

// ---------------------------------------------------------------- printability

export interface VerdictCopy {
  /** Short status shown in the badge (paired with an icon — never color alone). */
  label: string
  icon: string
  /** Plain-language "what happens / what to do next" for this verdict. */
  whatNext: string
}

export interface FindingCopy {
  label: string
  explanation: string
}

export const printabilityContent: {
  title: string
  pendingLabel: string
  findingsHeading: string
  verdicts: Record<Verdict, VerdictCopy>
  findings: Record<FindingKind, FindingCopy>
} = {
  title: "Printability",
  pendingLabel: "Checking printability…",
  findingsHeading: "What we found",
  verdicts: {
    pass: {
      label: "Ready to print",
      icon: "✓",
      whatNext: "This model passed our automated checks. You can configure and order it.",
    },
    warning: {
      label: "Printable with notes",
      icon: "!",
      whatNext: "This model can be printed, but read the notes below so the result matches your expectations.",
    },
    manual_review: {
      label: "Needs a human check",
      icon: "⚑",
      whatNext: "Our team will review this model before it can be printed. We’ll follow up if anything needs changing.",
    },
    fail: {
      label: "Not printable yet",
      icon: "✕",
      whatNext: "This model can’t be printed as-is. Adjust it (or your prompt) and try again — details are below.",
    },
  },
  findings: {
    empty_mesh: { label: "Empty model", explanation: "We couldn’t read any printable geometry from this file." },
    exceeds_build_volume: { label: "Too large", explanation: "The model is bigger than our printer’s build area. Scale it down or split it." },
    self_intersections: { label: "Overlapping surfaces", explanation: "Parts of the model pass through themselves, which printers can’t interpret reliably." },
    boundary_holes: { label: "Open holes", explanation: "The surface isn’t fully closed, so it may not print as a solid object." },
    non_manifold_edges: { label: "Non-manifold edges", explanation: "Some edges are shared by more than two faces — a common modelling artefact we’ll review." },
    inverted_normals: { label: "Flipped surfaces", explanation: "Some faces point the wrong way. We can suggest a fix, but we never change your model automatically." },
    multiple_components: { label: "Multiple pieces", explanation: "The model is made of separate bodies. That’s often fine, but small stray pieces get a closer look." },
    degenerate_geometry: { label: "Sliver triangles", explanation: "A few zero-area triangles were ignored during analysis." },
    below_min_wall: { label: "Thin walls", explanation: "The thinnest feature is below what this material prints reliably. It may be fragile." },
    unsupported_overhang: { label: "Steep overhangs", explanation: "Parts of the model overhang steeply and will need printed supports." },
    unstable_base: { label: "Small base", explanation: "The model’s contact with the print bed is small, which can cause it to detach." },
    trapped_volume: { label: "Sealed cavity", explanation: "There’s an enclosed hollow that can trap uncured material or air." },
  },
} as const

/**
 * Configure-tab copy (plan §6-S11). Plain-language descriptions for the quality,
 * strength and shipping options live here, keyed by the catalog ids in
 * `src/config/profiles.ts`. OWNER DECISION REQUIRED: real SLAs / surcharge copy.
 */
export const configurationContent = {
  title: "Configure",
  intro: "Set the size, material and finish for your print. Changes save automatically.",
  measuringLabel: "We’re measuring your model — configuration will unlock in a moment.",
  loadingLabel: "Loading configuration…",
  size: {
    label: "Size (longest side)",
    unit: "mm",
    help: "The model scales uniformly, so its proportions stay the same.",
  },
  material: { label: "Material" },
  color: { label: "Colour", outOfStock: "Out of stock" },
  quality: {
    label: "Print quality",
    options: {
      standard: { name: "Standard", description: "Faster and cheaper. Good for most models." },
      fine: { name: "Fine", description: "Finer layers and smoother surfaces. Slower and a little pricier." },
    } as Record<string, { name: string; description: string }>,
  },
  strength: {
    label: "Strength",
    options: {
      display: { name: "Display", description: "Light infill — best for models you’ll look at, not handle." },
      everyday: { name: "Everyday", description: "Balanced infill for parts you’ll use and handle." },
      reinforced: { name: "Reinforced", description: "Dense infill for functional, load-bearing parts." },
    } as Record<string, { name: string; description: string }>,
  },
  shipping: {
    label: "Shipping",
    options: {
      standard: { name: "Standard", description: "Our usual delivery speed." },
      express: { name: "Express", description: "Prioritised production and faster delivery." },
    } as Record<string, { name: string; description: string }>,
  },
  instructions: {
    label: "Special instructions",
    placeholder: "Anything we should know? (e.g. “please remove supports carefully”)",
  },
  textureDisclaimer:
    "FDM prints show fine horizontal layer lines and won’t look glossy — colours are indicative.",
  save: "Save",
  saving: "Saving…",
  saved: "Saved",
  saveError: "Couldn’t save — please try again.",
  revalidating: "Re-checking printability at the new size…",
} as const
