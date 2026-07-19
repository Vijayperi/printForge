/**
 * Core domain types (plan §4.2) plus database Row types (plan §4.5).
 * Type-only module — no runtime code. Grown across sessions.
 */

// ------------------------------------------------------------------ enums
export type Role = "customer" | "operator" | "admin"
export type DesignSource = "generated" | "uploaded"
export type AssetType =
  | "model_glb"
  | "model_stl"
  | "model_3mf"
  | "thumbnail"
  | "gcode"
  | "reference_image"
export type Verdict = "pass" | "warning" | "manual_review" | "fail"
export type ProjectStatus = "active" | "archived"
export type ActorKind = "user" | "system"
export type JobStatus = "pending" | "running" | "done" | "failed" | "dead"

export type FindingKind =
  | "non_manifold_edges"
  | "boundary_holes"
  | "self_intersections"
  | "inverted_normals"
  | "multiple_components"
  | "degenerate_geometry"
  | "empty_mesh"
  | "exceeds_build_volume"
  | "below_min_wall"
  | "unsupported_overhang"
  | "unstable_base"
  | "trapped_volume"

export interface Finding {
  kind: FindingKind
  severity: "info" | "warning" | "blocking"
  detail: string
  count?: number
}

export interface Measurements {
  boundingMm: { x: number; y: number; z: number }
  volumeCm3: number
  surfaceAreaCm2: number
  triangleCount: number
  componentCount: number
}

export interface StructuredBrief {
  intendedUse: string
  approxSizeMm: number
  style: string
  durability: "display" | "everyday" | "reinforced"
  materialPref?: string
  colorPref?: string
  rawPrompt: string
}

export interface QuoteBreakdownLine {
  key: string
  label: string
  amount: { amountMinor: number; currency: "INR" }
}

// ------------------------------------------------------------------ row types
interface Timestamps {
  created_at: string
  updated_at: string
}

export interface ProjectRow extends Timestamps {
  id: string
  user_id: string
  title: string
  status: ProjectStatus
}

export interface AssetRow extends Timestamps {
  id: string
  type: AssetType
  storage_key: string
  checksum_sha256: string
  bytes: number
  mime: string
  source_asset_id: string | null
}

export interface DesignVersionRow extends Timestamps {
  id: string
  project_id: string
  source: DesignSource
  version_no: number
  prompt: string | null
  brief_json: StructuredBrief | null
  provider_task_id: string | null
  glb_asset_id: string | null
  stl_asset_id: string | null
  thumbnail_asset_id: string | null
  generation_status: string
}

export interface ValidationReportRow extends Timestamps {
  id: string
  design_version_id: string
  printer_profile_id: string
  status: string
  findings_json: Finding[]
  measurements_json: Measurements | null
  scale_hash: string
}

export interface PrintConfigurationRow extends Timestamps {
  id: string
  design_version_id: string
  material_id: string
  color_id: string
  dimensions_mm: { x: number; y: number; z: number }
  scale_factor: number
  quality_id: string
  strength_id: string
  shipping_speed: string
  special_instructions: string
}

export interface QuoteRow extends Timestamps {
  id: string
  configuration_id: string
  status: string
  amount_minor: number
  currency: string
  breakdown_json: QuoteBreakdownLine[]
  slice_json: Record<string, unknown> | null
  expires_at: string
}

export interface OrderRow extends Timestamps {
  id: string
  user_id: string
  quote_id: string
  status: string
  payment_status: string
  held_from_status: string | null
  contact_json: Record<string, unknown>
  shipping_address_json: Record<string, unknown>
  provider_session_id: string | null
  payment_ref: string | null
  frozen_dv_id: string
  frozen_config_json: Record<string, unknown>
}

export interface PrinterRow extends Timestamps {
  id: string
  name: string
  gateway_kind: string
  capabilities_json: Record<string, unknown>
  current_state: string
  last_seen_at: string | null
}

export interface PrintJobRow extends Timestamps {
  id: string
  order_id: string
  printer_id: string | null
  status: string
  gcode_asset_id: string | null
  slice_json: Record<string, unknown> | null
  gateway_job_ref: string | null
  failure_reason: string | null
  attempt: number
}

export interface ShipmentRow extends Timestamps {
  id: string
  order_id: string
  carrier: string
  tracking_number: string
  status: string
}

export interface AuditEventRow {
  id: string
  actor_id: string | null
  actor_kind: ActorKind
  entity_type: string
  entity_id: string
  action: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface JobRow extends Timestamps {
  id: string
  type: string
  payload: Record<string, unknown>
  status: JobStatus
  idempotency_key: string
  attempts: number
  max_attempts: number
  run_at: string
  locked_by: string | null
  locked_at: string | null
  last_error: string | null
}

export interface WebhookEventRow {
  id: string
  provider: string
  event_id: string
  received_at: string
  payload: Record<string, unknown>
  processing_result: string | null
  created_at: string
}

export interface NotificationLogRow extends Timestamps {
  id: string
  order_id: string | null
  to_email: string
  template: string
  status: string
  message_ref: string | null
  error: string | null
}
