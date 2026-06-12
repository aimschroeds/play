import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import { commitItemImport, deleteItem, ItemInUseError } from '../store/repos'
import { calorieDensity } from '../domain/density'
import {
  itemsToCsv,
  parseItemsCsv,
  planItemImport,
  type CsvIssue,
  type DuplicateResolution,
  type ParsedItemRow,
} from '../domain/csv/items'
import type { InputBasis, Item } from '../domain/types'
import { downloadCsv } from './download'
import { fmtDensity } from './format'
import { VegBadge } from './VegBadge'

const BASES: { value: InputBasis; label: string }[] = [
  { value: 'per_gram', label: 'per gram' },
  { value: 'per_100g', label: 'per 100 g' },
  { value: 'per_serving', label: 'per serving' },
  { value: 'per_package', label: 'per package' },
]

interface Draft {
  name: string
  basis: InputBasis
  weightG: string
  calories: string
  vegetarian: boolean
}

const emptyDraft: Draft = {
  name: '',
  basis: 'per_100g',
  weightG: '100',
  calories: '',
  vegetarian: true,
}

function draftDensity(draft: Draft): number | null {
  const weightG = Number(draft.weightG)
  const calories = Number(draft.calories)
  if (draft.weightG === '' || draft.calories === '') return null
  try {
    return calorieDensity({ weightG, calories })
  } catch {
    return null
  }
}

type SortKey = 'name' | 'density'

export function ItemsPage() {
  const items = useLiveQuery(() => db.items.toArray(), [], [] as Item[])
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [vegOnly, setVegOnly] = useState(false)

  const density = draftDensity(draft)
  const canSave = draft.name.trim() !== '' && density !== null

  async function save() {
    if (density === null) return
    const item: Item = {
      id: editingId ?? crypto.randomUUID(),
      name: draft.name.trim(),
      caloriesPerGram: density,
      vegetarian: draft.vegetarian,
      inputBasis: draft.basis,
      inputWeightG: Number(draft.weightG),
      inputCalories: Number(draft.calories),
    }
    await db.items.put(item)
    setDraft(emptyDraft)
    setEditingId(null)
    setError(null)
  }

  function startEdit(item: Item) {
    setEditingId(item.id)
    setDraft({
      name: item.name,
      basis: item.inputBasis,
      weightG: String(item.inputWeightG),
      calories: String(item.inputCalories),
      vegetarian: item.vegetarian,
    })
    setError(null)
  }

  async function remove(id: string) {
    try {
      await deleteItem(id)
      setError(null)
    } catch (e) {
      setError(e instanceof ItemInUseError ? `Cannot delete: ${e.message}` : String(e))
    }
  }

  const visible = items
    .filter((i) => !vegOnly || i.vegetarian)
    .sort((a, b) =>
      sortKey === 'name'
        ? a.name.localeCompare(b.name)
        : b.caloriesPerGram - a.caloriesPerGram,
    )

  return (
    <div className="space-y-6">
      <form
        className="space-y-3 rounded-lg border border-gray-200 bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <h2 className="font-semibold text-gray-800">
          {editingId ? 'Edit item' : 'Add item'}
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-sm text-gray-600">Name</span>
            <input
              className="mt-1 rounded border border-gray-300 px-2 py-1"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Oatmeal"
            />
          </label>
          <label className="block">
            <span className="block text-sm text-gray-600">Entered</span>
            <select
              className="mt-1 rounded border border-gray-300 px-2 py-1"
              value={draft.basis}
              onChange={(e) => setDraft({ ...draft, basis: e.target.value as InputBasis })}
            >
              {BASES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-sm text-gray-600">Weight (g)</span>
            <input
              className="mt-1 w-24 rounded border border-gray-300 px-2 py-1"
              inputMode="decimal"
              value={draft.weightG}
              onChange={(e) => setDraft({ ...draft, weightG: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="block text-sm text-gray-600">Calories</span>
            <input
              className="mt-1 w-24 rounded border border-gray-300 px-2 py-1"
              inputMode="decimal"
              value={draft.calories}
              onChange={(e) => setDraft({ ...draft, calories: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-1 pb-1.5">
            <input
              type="checkbox"
              checked={draft.vegetarian}
              onChange={(e) => setDraft({ ...draft, vegetarian: e.target.checked })}
            />
            <span className="text-sm text-gray-600">vegetarian</span>
          </label>
          <span className="pb-1.5 text-sm text-gray-500">
            {density !== null ? `= ${fmtDensity(density)}` : '—'}
          </span>
          <button
            type="submit"
            disabled={!canSave}
            className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {editingId ? 'Save' : 'Add'}
          </button>
          {editingId && (
            <button
              type="button"
              className="pb-1.5 text-sm text-gray-500 underline"
              onClick={() => {
                setEditingId(null)
                setDraft(emptyDraft)
              }}
            >
              cancel
            </button>
          )}
        </div>
      </form>

      {error && (
        <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="flex items-center gap-4 text-sm">
        <label className="flex items-center gap-1">
          sort by
          <select
            className="rounded border border-gray-300 px-1 py-0.5"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
          >
            <option value="name">name</option>
            <option value="density">density</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={vegOnly}
            onChange={(e) => setVegOnly(e.target.checked)}
          />
          vegetarian only
        </label>
      </div>

      <ItemsImportExport items={items} />

      {visible.length === 0 ? (
        <p className="text-sm text-gray-500">No items yet — add your first above.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-300 text-left text-gray-600">
              <th className="py-1 pr-2">Name</th>
              <th className="py-1 pr-2">Entered as</th>
              <th className="py-1 pr-2 text-right">Density</th>
              <th className="py-1 pr-2">Diet</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => (
              <tr key={item.id} className="border-b border-gray-100">
                <td className="py-1.5 pr-2 font-medium">{item.name}</td>
                <td className="py-1.5 pr-2 text-gray-500">
                  {Math.round(item.inputCalories)} cal / {Math.round(item.inputWeightG)} g
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {fmtDensity(item.caloriesPerGram)}
                </td>
                <td className="py-1.5 pr-2">
                  <VegBadge vegetarian={item.vegetarian} />
                </td>
                <td className="py-1.5 text-right">
                  <button
                    className="mr-3 text-emerald-700 underline"
                    onClick={() => startEdit(item)}
                  >
                    edit
                  </button>
                  <button
                    className="text-red-700 underline"
                    onClick={() => void remove(item.id)}
                  >
                    delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function ItemsImportExport({ items }: { items: Item[] }) {
  const [parsed, setParsed] = useState<{ rows: ParsedItemRow[]; issues: CsvIssue[] } | null>(null)
  const [resolution, setResolution] = useState<DuplicateResolution>('skip')
  const plan = parsed ? planItemImport(parsed.rows, items, resolution) : null

  return (
    <details className="rounded-lg border border-gray-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold text-gray-800">
        Import / export CSV
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void file.text().then((text) => setParsed(parseItemsCsv(text)))
              e.target.value = ''
            }}
          />
          <button
            className="text-emerald-700 underline disabled:text-gray-400"
            disabled={items.length === 0}
            onClick={() => downloadCsv('items.csv', itemsToCsv(items))}
          >
            export {items.length} items
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Columns: name, weight_g, calories, vegetarian — weight/calories on any consistent
          basis.
        </p>
        {parsed && plan && (
          <div className="space-y-2 rounded border border-gray-200 bg-gray-50 p-3">
            <p>
              <span className="font-medium">{plan.creates.length}</span> to create,{' '}
              <span className="font-medium">{plan.updates.length}</span> to update,{' '}
              <span className="font-medium">{plan.skipped.length}</span> skipped,{' '}
              <span className="font-medium">{parsed.issues.length}</span> bad rows
            </p>
            <label className="flex items-center gap-2">
              duplicates:
              <select
                className="rounded border border-gray-300 px-1 py-0.5"
                value={resolution}
                onChange={(e) => setResolution(e.target.value as DuplicateResolution)}
              >
                <option value="skip">skip</option>
                <option value="update">update existing</option>
                <option value="copy">import as copy</option>
              </select>
            </label>
            {parsed.issues.length > 0 && (
              <ul className="list-inside list-disc text-xs text-red-700">
                {parsed.issues.map((issue) => (
                  <li key={issue.line}>
                    line {issue.line}: {issue.reason}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-3">
              <button
                className="rounded bg-emerald-700 px-3 py-1 font-medium text-white disabled:opacity-40"
                disabled={plan.creates.length === 0 && plan.updates.length === 0}
                onClick={() => {
                  void commitItemImport(plan).then(() => setParsed(null))
                }}
              >
                Import
              </button>
              <button className="text-gray-500 underline" onClick={() => setParsed(null)}>
                cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </details>
  )
}
