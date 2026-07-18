/**
 * All owner-facing marketing copy and catalog-ish display data.
 * Session 2 scope: landing page only. Later sessions extend this file
 * (moderation wordlists, policy text, email copy).
 */

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
