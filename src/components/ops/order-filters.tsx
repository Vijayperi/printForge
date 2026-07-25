import { Button } from "@/src/components/ui/button"
import { Input } from "@/src/components/ui/input"
import { Label } from "@/src/components/ui/label"
import { opsContent } from "@/src/config/content"
import { materialProfiles } from "@/src/config/profiles"
import { OPS_EXCEPTION_LABELS, OPS_EXCEPTION_REASONS } from "@/src/domain/ops/board"
import { ORDER_CUSTOMER_LABELS, type OrderState } from "@/src/domain/stateMachines/order"
import type { OpsOrderFilter } from "@/src/domain/ops/board"

export interface FilterOption {
  value: string
  label: string
}

const STATUS_OPTIONS: FilterOption[] = (
  Object.keys(ORDER_CUSTOMER_LABELS) as OrderState[]
).map((state) => ({ value: state, label: ORDER_CUSTOMER_LABELS[state] }))

const MATERIAL_OPTIONS: FilterOption[] = materialProfiles.map((m) => ({
  value: m.id,
  label: m.name,
}))

const EXCEPTION_OPTIONS: FilterOption[] = OPS_EXCEPTION_REASONS.map((reason) => ({
  value: reason,
  label: OPS_EXCEPTION_LABELS[reason],
}))

/**
 * Board filters as a plain GET form (plan §6-S14 step 1). Submitting writes the
 * query string, the server re-queries, and the whole thing works without
 * client-side JavaScript — the filtering was never in the browser anyway.
 */
export function OrderFilters({
  filter,
  printers,
}: {
  filter: OpsOrderFilter
  printers: FilterOption[]
}) {
  return (
    <form
      method="get"
      aria-label={opsContent.filterHeading}
      className="grid gap-3 rounded-xl border p-4 sm:grid-cols-3 lg:grid-cols-5"
    >
      <Select name="status" label={opsContent.columns.status} value={filter.status} options={STATUS_OPTIONS} />
      <Select name="materialId" label={opsContent.columns.material} value={filter.materialId} options={MATERIAL_OPTIONS} />
      <Select name="printerId" label={opsContent.columns.printer} value={filter.printerId} options={printers} />
      <Select name="exception" label={opsContent.columns.exception} value={filter.exception} options={EXCEPTION_OPTIONS} />

      <div className="space-y-1">
        <Label htmlFor="filter-dueBefore">{opsContent.columns.due}</Label>
        <Input id="filter-dueBefore" name="dueBefore" type="date" defaultValue={filter.dueBefore ?? ""} />
      </div>

      <div className="flex items-end gap-2 sm:col-span-3 lg:col-span-5">
        <Button type="submit" size="sm">
          {opsContent.apply}
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href="/ops">{opsContent.clear}</a>
        </Button>
      </div>
    </form>
  )
}

function Select({
  name,
  label,
  value,
  options,
}: {
  name: string
  label: string
  value: string | undefined
  options: FilterOption[]
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={`filter-${name}`}>{label}</Label>
      <select
        id={`filter-${name}`}
        name={name}
        defaultValue={value ?? ""}
        className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
      >
        <option value="">{opsContent.anyOption}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
