import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import { deleteMeal } from '../store/repos'
import { rollUpMeal } from '../domain/rollups'
import type { Item, Meal, MealType } from '../domain/types'
import { fmtCalories, fmtDensity, fmtGrams } from './format'
import { VegBadge } from './VegBadge'

const MEAL_TYPES: MealType[] = ['brekkie', 'snack', 'lunch', 'dinner']

interface ComponentDraft {
  itemId: string
  grams: string
}

interface Draft {
  name: string
  type: MealType
  components: ComponentDraft[]
}

const emptyDraft: Draft = { name: '', type: 'brekkie', components: [] }

function draftToMeal(draft: Draft, id: string): Meal | null {
  if (draft.name.trim() === '' || draft.components.length === 0) return null
  const components = []
  for (const c of draft.components) {
    const grams = Number(c.grams)
    if (c.itemId === '' || !Number.isFinite(grams) || grams <= 0) return null
    components.push({ itemId: c.itemId, grams })
  }
  return { id, name: draft.name.trim(), type: draft.type, components }
}

type SortKey = 'name' | 'density'

export function MealsPage() {
  const items = useLiveQuery(() => db.items.toArray(), [], [] as Item[])
  const meals = useLiveQuery(() => db.meals.toArray(), [], [] as Meal[])
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<MealType | 'all'>('all')
  const [vegOnly, setVegOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('name')

  const itemsById = new Map(items.map((i) => [i.id, i]))
  const previewMeal = draftToMeal(draft, 'preview')
  const preview = previewMeal ? rollUpMeal(previewMeal, itemsById) : null

  function updateComponent(index: number, patch: Partial<ComponentDraft>) {
    setDraft({
      ...draft,
      components: draft.components.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    })
  }

  async function save() {
    const meal = draftToMeal(draft, editingId ?? crypto.randomUUID())
    if (!meal) return
    await db.meals.put(meal)
    setDraft(emptyDraft)
    setEditingId(null)
  }

  function startEdit(meal: Meal) {
    setEditingId(meal.id)
    setDraft({
      name: meal.name,
      type: meal.type,
      components: meal.components.map((c) => ({ itemId: c.itemId, grams: String(c.grams) })),
    })
  }

  const rows = meals
    .map((meal) => ({ meal, rollup: rollUpMeal(meal, itemsById) }))
    .filter(({ meal }) => typeFilter === 'all' || meal.type === typeFilter)
    .filter(({ rollup }) => !vegOnly || rollup.vegetarian)
    .sort((a, b) =>
      sortKey === 'name'
        ? a.meal.name.localeCompare(b.meal.name)
        : b.rollup.density - a.rollup.density,
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
          {editingId ? 'Edit meal' : 'Compose meal'}
        </h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-sm text-gray-600">Name</span>
            <input
              className="mt-1 rounded border border-gray-300 px-2 py-1"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Standard oatmeal brekkie"
            />
          </label>
          <label className="block">
            <span className="block text-sm text-gray-600">Type</span>
            <select
              className="mt-1 rounded border border-gray-300 px-2 py-1"
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value as MealType })}
            >
              {MEAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="space-y-2">
          {draft.components.map((c, index) => (
            <div key={index} className="flex items-center gap-2">
              <select
                className="rounded border border-gray-300 px-2 py-1"
                value={c.itemId}
                onChange={(e) => updateComponent(index, { itemId: e.target.value })}
              >
                <option value="">— pick item —</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
              <input
                className="w-20 rounded border border-gray-300 px-2 py-1"
                inputMode="decimal"
                placeholder="g"
                value={c.grams}
                onChange={(e) => updateComponent(index, { grams: e.target.value })}
              />
              <span className="text-sm text-gray-500">g</span>
              <button
                type="button"
                className="text-sm text-red-700 underline"
                onClick={() =>
                  setDraft({
                    ...draft,
                    components: draft.components.filter((_, i) => i !== index),
                  })
                }
              >
                remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-sm text-emerald-700 underline disabled:text-gray-400"
            disabled={items.length === 0}
            onClick={() =>
              setDraft({ ...draft, components: [...draft.components, { itemId: '', grams: '' }] })
            }
          >
            + add item
          </button>
          {items.length === 0 && (
            <span className="ml-2 text-sm text-gray-500">(add items in the Items tab first)</span>
          )}
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">
            {preview
              ? `${fmtGrams(preview.weightG)} · ${fmtCalories(preview.calories)} · ${fmtDensity(preview.density)}`
              : '—'}
          </span>
          {preview && <VegBadge vegetarian={preview.vegetarian} />}
          <button
            type="submit"
            disabled={!preview}
            className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {editingId ? 'Save' : 'Add to library'}
          </button>
          {editingId && (
            <button
              type="button"
              className="text-sm text-gray-500 underline"
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

      <div className="flex items-center gap-4 text-sm">
        <label className="flex items-center gap-1">
          type
          <select
            className="rounded border border-gray-300 px-1 py-0.5"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as MealType | 'all')}
          >
            <option value="all">all</option>
            {MEAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
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

      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">No meals match.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-300 text-left text-gray-600">
              <th className="py-1 pr-2">Name</th>
              <th className="py-1 pr-2">Type</th>
              <th className="py-1 pr-2">Items</th>
              <th className="py-1 pr-2 text-right">Weight</th>
              <th className="py-1 pr-2 text-right">Calories</th>
              <th className="py-1 pr-2 text-right">Density</th>
              <th className="py-1 pr-2">Diet</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ meal, rollup }) => (
              <tr key={meal.id} className="border-b border-gray-100">
                <td className="py-1.5 pr-2 font-medium">{meal.name}</td>
                <td className="py-1.5 pr-2">{meal.type}</td>
                <td className="py-1.5 pr-2 text-gray-500">
                  {meal.components
                    .map((c) => `${itemsById.get(c.itemId)?.name ?? '?'} ${Math.round(c.grams)}g`)
                    .join(', ')}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{fmtGrams(rollup.weightG)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {fmtCalories(rollup.calories)}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {fmtDensity(rollup.density)}
                </td>
                <td className="py-1.5 pr-2">
                  <VegBadge vegetarian={rollup.vegetarian} />
                </td>
                <td className="py-1.5 text-right">
                  <button
                    className="mr-3 text-emerald-700 underline"
                    onClick={() => startEdit(meal)}
                  >
                    edit
                  </button>
                  <button
                    className="text-red-700 underline"
                    onClick={() => void deleteMeal(meal.id)}
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
