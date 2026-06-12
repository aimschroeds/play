// Item CSV codec (stories 4.8, 4.10).
// Columns: name, weight_g, calories, vegetarian — weight/calories on any
// consistent basis, normalized to density on import. Export emits the raw
// entry values so a round-trip is lossless.

import Papa from 'papaparse'
import type { Item } from '../types'

export const ITEM_CSV_COLUMNS = ['name', 'weight_g', 'calories', 'vegetarian'] as const

export interface CsvIssue {
  line: number
  reason: string
}

export interface ItemFields {
  name: string
  weightG: number
  calories: number
  vegetarian: boolean
}

export interface ParsedItemRow {
  line: number
  fields: ItemFields
}

export function parseBool(raw: string): boolean | null {
  const v = raw.trim().toLowerCase()
  if (['true', 'yes', 'y', '1'].includes(v)) return true
  if (['false', 'no', 'n', '0'].includes(v)) return false
  return null
}

/** Bad rows are reported with line number and reason without blocking
 *  valid rows (story 4.8). Line numbers are 1-based including the header. */
export function parseItemsCsv(text: string): { rows: ParsedItemRow[]; issues: CsvIssue[] } {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
  })
  const rows: ParsedItemRow[] = []
  const issues: CsvIssue[] = []

  const missing = ITEM_CSV_COLUMNS.filter((c) => !parsed.meta.fields?.includes(c))
  if (missing.length > 0) {
    return { rows, issues: [{ line: 1, reason: `missing column(s): ${missing.join(', ')}` }] }
  }

  parsed.data.forEach((raw, i) => {
    const line = i + 2
    const name = (raw.name ?? '').trim()
    const weightG = Number(raw.weight_g)
    const calories = Number(raw.calories)
    const vegetarian = parseBool(raw.vegetarian ?? '')

    if (name === '') return issues.push({ line, reason: 'missing name' })
    if (raw.weight_g?.trim() === '' || !Number.isFinite(weightG) || weightG <= 0) {
      return issues.push({ line, reason: `weight_g must be a positive number, got "${raw.weight_g}"` })
    }
    if (raw.calories?.trim() === '' || !Number.isFinite(calories) || calories < 0) {
      return issues.push({ line, reason: `calories must be a non-negative number, got "${raw.calories}"` })
    }
    if (vegetarian === null) {
      return issues.push({ line, reason: `vegetarian must be true/false, got "${raw.vegetarian}"` })
    }
    rows.push({ line, fields: { name, weightG, calories, vegetarian } })
  })

  return { rows, issues }
}

export type DuplicateResolution = 'skip' | 'update' | 'copy'

export interface ItemImportPlan {
  creates: ItemFields[]
  updates: { item: Item; fields: ItemFields }[]
  skipped: { line: number; name: string }[]
}

/** Apply the duplicate policy (story 4.8): duplicates vs the library or
 *  within the file are skipped, update the existing item, or imported as
 *  a renamed copy. Name matching is case-insensitive. */
export function planItemImport(
  rows: ParsedItemRow[],
  existing: Item[],
  resolution: DuplicateResolution,
): ItemImportPlan {
  const plan: ItemImportPlan = { creates: [], updates: [], skipped: [] }
  const existingByName = new Map(existing.map((i) => [i.name.toLowerCase(), i]))
  const takenNames = new Set(existing.map((i) => i.name.toLowerCase()))
  const plannedCreateByName = new Map<string, ItemFields>()
  const plannedUpdateById = new Map<string, { item: Item; fields: ItemFields }>()

  const copyName = (base: string): string => {
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? `${base} (copy)` : `${base} (copy ${n})`
      if (!takenNames.has(candidate.toLowerCase())) return candidate
    }
  }

  for (const { line, fields } of rows) {
    const key = fields.name.toLowerCase()
    const inLibrary = existingByName.get(key)
    const inFile = plannedCreateByName.get(key)

    if (!inLibrary && !inFile) {
      plannedCreateByName.set(key, fields)
      takenNames.add(key)
      continue
    }
    switch (resolution) {
      case 'skip':
        plan.skipped.push({ line, name: fields.name })
        break
      case 'update':
        if (inLibrary) plannedUpdateById.set(inLibrary.id, { item: inLibrary, fields })
        else plannedCreateByName.set(key, fields) // later in-file row wins
        break
      case 'copy': {
        const renamed = { ...fields, name: copyName(fields.name) }
        plannedCreateByName.set(renamed.name.toLowerCase(), renamed)
        takenNames.add(renamed.name.toLowerCase())
        break
      }
    }
  }

  plan.creates = [...plannedCreateByName.values()]
  plan.updates = [...plannedUpdateById.values()]
  return plan
}

/** Same columns as import — an export re-imports without modification. */
export function itemsToCsv(items: Item[]): string {
  return Papa.unparse(
    items.map((i) => ({
      name: i.name,
      weight_g: i.inputWeightG,
      calories: i.inputCalories,
      vegetarian: i.vegetarian,
    })),
    { columns: [...ITEM_CSV_COLUMNS] },
  )
}
