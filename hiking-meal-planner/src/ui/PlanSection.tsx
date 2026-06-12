import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import { clearPlanEntry, setPlanEntry } from '../store/repos'
import { carryEnd, carryStart, deriveCarries, keyedSlots, type KeyedSlot } from '../domain/carries'
import { generateDayPlan } from '../domain/generate'
import { rollUpMeal } from '../domain/rollups'
import {
  carryTotals,
  combineTotals,
  dayTotals,
  entryTotals,
  planKey,
  type DayStatus,
} from '../domain/totals'
import { itemsToCsv } from '../domain/csv/items'
import { mealsToCsv } from '../domain/csv/meals'
import type { Day, Item, Meal, Person, PlanEntry, Resupply, Trip } from '../domain/types'
import { downloadCsv } from './download'
import { fmtCalories, fmtDensity, fmtGrams, fmtSlot } from './format'

const OFF_TRAIL = '@offtrail'

const STATUS_STYLES: Record<DayStatus, string> = {
  ok: 'bg-green-100 text-green-800',
  under: 'bg-red-100 text-red-800',
  over: 'bg-amber-100 text-amber-800',
  partial: 'bg-sky-100 text-sky-800',
}

const STATUS_LABELS: Record<DayStatus, string> = {
  ok: 'on target',
  under: 'under',
  over: 'over',
  partial: 'partially estimated',
}

export function PlanSection({ trip, people }: { trip: Trip; people: Person[] }) {
  const [personId, setPersonId] = useState<string | null>(null)
  const items = useLiveQuery(() => db.items.toArray(), [], [] as Item[])
  const meals = useLiveQuery(() => db.meals.toArray(), [], [] as Meal[])
  const resupplies = useLiveQuery(
    () => db.resupplies.where('tripId').equals(trip.id).toArray(),
    [trip.id],
    [] as Resupply[],
  )
  const allEntries = useLiveQuery(
    () => db.planEntries.where('tripId').equals(trip.id).toArray(),
    [trip.id],
    [] as PlanEntry[],
  )

  const person = people.find((p) => p.id === personId) ?? people[0]
  if (!person) {
    return <p className="text-sm text-gray-500">Add people in the Setup view first.</p>
  }

  const itemsById = new Map(items.map((i) => [i.id, i]))
  const mealsById = new Map(meals.map((m) => [m.id, m]))
  const entriesByKey = new Map(
    allEntries.map((e) => [planKey(e.personId, e.dayIndex, e.slotKey), e]),
  )
  const carries = deriveCarries(trip, resupplies)
  const personIds = people.map((p) => p.id)

  const perCarry = carries.map((carry) =>
    carryTotals({ carry, personIds, entriesByKey, mealsById, itemsById }),
  )
  const tripGroup = combineTotals(perCarry.map((c) => c.group))
  const tripPerson = combineTotals(
    perCarry.map((c) => c.perPerson.get(person.id) ?? { weightG: 0, calories: 0, density: 0 }),
  )

  // Generation fills unlocked, on-trail slots around manual picks; tapping
  // again regenerates with fresh randomness (stories 8.1-8.3).
  async function generateForDay(day: Day) {
    const dayEntries = allEntries.filter(
      (e) => e.personId === person.id && e.dayIndex === day.index,
    )
    const generated = generateDayPlan({
      trip,
      day,
      person,
      meals,
      itemsById,
      existingEntries: dayEntries,
      rng: Math.random,
    })
    const generatedKeys = new Set(generated.map((e) => e.slotKey))
    for (const e of dayEntries) {
      if (e.kind === 'meal' && !e.locked && !generatedKeys.has(e.slotKey)) {
        await clearPlanEntry(trip.id, person.id, day.index, e.slotKey)
      }
    }
    for (const e of generated) await setPlanEntry(e)
  }

  async function generateAll() {
    for (const day of trip.days) await generateForDay(day)
  }

  // Export scoped to what this trip's plan actually uses (story 4.10).
  function exportUsed() {
    const usedMealIds = new Set(
      allEntries.filter((e) => e.kind === 'meal' && e.mealId).map((e) => e.mealId!),
    )
    const usedMeals = meals.filter((m) => usedMealIds.has(m.id))
    const usedItemIds = new Set(usedMeals.flatMap((m) => m.components.map((c) => c.itemId)))
    const slug = trip.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    downloadCsv(`${slug}-meals.csv`, mealsToCsv(usedMeals, itemsById))
    downloadCsv(`${slug}-items.csv`, itemsToCsv(items.filter((i) => usedItemIds.has(i.id))))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        {people.length > 1 &&
          people.map((p) => (
            <button
              key={p.id}
              onClick={() => setPersonId(p.id)}
              className={
                p.id === person.id
                  ? 'rounded bg-emerald-700 px-3 py-1 text-sm font-medium text-white'
                  : 'rounded border border-gray-300 px-3 py-1 text-sm text-gray-600'
              }
            >
              {p.name}
            </button>
          ))}
        <button
          className="ml-auto rounded border border-emerald-700 px-3 py-1 text-sm font-medium text-emerald-800 disabled:opacity-40"
          disabled={meals.length === 0}
          onClick={() => void generateAll()}
          title="Fill unlocked slots on every day; locked picks and off-trail slots are kept"
        >
          ✨ generate all days
        </button>
      </div>

      <div className="space-y-4">
        {trip.days.map((day) => (
          <DayCard
            key={day.index}
            trip={trip}
            day={day}
            person={person}
            entriesByKey={entriesByKey}
            meals={meals}
            mealsById={mealsById}
            itemsById={itemsById}
            onGenerate={() => void generateForDay(day)}
          />
        ))}
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-2 flex items-center">
          <h3 className="font-semibold text-gray-800">Carries</h3>
          <button
            className="ml-auto text-sm text-emerald-700 underline disabled:text-gray-400"
            disabled={allEntries.length === 0}
            onClick={exportUsed}
          >
            export this trip's meals + items CSV
          </button>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-300 text-left text-gray-600">
              <th className="py-1 pr-2">Carry</th>
              <th className="py-1 pr-2">Boundary</th>
              <th className="py-1 pr-2 text-right">{person.name} weight</th>
              <th className="py-1 pr-2 text-right">{person.name} cal</th>
              <th className="py-1 pr-2 text-right">Density</th>
              <th className="py-1 pr-2 text-right">Group weight</th>
            </tr>
          </thead>
          <tbody>
            {carries.map((carry, i) => {
              const mine = perCarry[i].perPerson.get(person.id)!
              return (
                <tr key={carry.index} className="border-b border-gray-100">
                  <td className="py-1.5 pr-2 font-medium">{carry.index}</td>
                  <td className="py-1.5 pr-2 text-gray-600">
                    d{carryStart(carry).dayIndex} {fmtSlot(carryStart(carry).slot)} → d
                    {carryEnd(carry).dayIndex} {fmtSlot(carryEnd(carry).slot)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{fmtGrams(mine.weightG)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {fmtCalories(mine.calories)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {fmtDensity(mine.density)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {fmtGrams(perCarry[i].group.weightG)}
                  </td>
                </tr>
              )
            })}
            <tr className="font-medium">
              <td className="py-1.5 pr-2">Trip</td>
              <td className="py-1.5 pr-2" />
              <td className="py-1.5 pr-2 text-right tabular-nums">
                {fmtGrams(tripPerson.weightG)}
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">
                {fmtCalories(tripPerson.calories)}
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">
                {fmtDensity(tripPerson.density)}
              </td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{fmtGrams(tripGroup.weightG)}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  )
}

function DayCard({
  trip,
  day,
  person,
  entriesByKey,
  meals,
  mealsById,
  itemsById,
  onGenerate,
}: {
  trip: Trip
  day: Day
  person: Person
  entriesByKey: ReadonlyMap<string, PlanEntry>
  meals: Meal[]
  mealsById: ReadonlyMap<string, Meal>
  itemsById: ReadonlyMap<string, Item>
  onGenerate: () => void
}) {
  const slots = keyedSlots(day)
  const dayEntries = slots
    .map((s) => entriesByKey.get(planKey(person.id, day.index, s.key)))
    .filter((e): e is PlanEntry => e !== undefined)

  const totals = dayTotals({
    day,
    person,
    factors: trip.dayTypeFactors,
    entries: dayEntries,
    mealsById,
    itemsById,
  })

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-3">
        <h4 className="font-semibold text-gray-800">
          Day {day.index}
          <span className="ml-2 font-normal text-gray-500">
            {day.type} · target {fmtCalories(totals.target)}
          </span>
        </h4>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[totals.status]}`}
        >
          {STATUS_LABELS[totals.status]} · {fmtCalories(totals.calories)} (
          {totals.delta >= 0 ? '+' : ''}
          {Math.round(totals.deltaPct * 100)}%) · {fmtGrams(totals.weightG)}
        </span>
        <button
          className="rounded border border-emerald-700 px-2 py-0.5 text-xs font-medium text-emerald-800 disabled:opacity-40"
          disabled={meals.length === 0}
          onClick={onGenerate}
          title="Fill unlocked slots; tap again to regenerate"
        >
          ✨ generate
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {slots.map((keyed) => (
          <SlotCell
            key={keyed.key}
            trip={trip}
            dayIndex={day.index}
            person={person}
            keyed={keyed}
            entry={entriesByKey.get(planKey(person.id, day.index, keyed.key))}
            meals={meals}
            mealsById={mealsById}
            itemsById={itemsById}
          />
        ))}
      </div>
    </section>
  )
}

function SlotCell({
  trip,
  dayIndex,
  person,
  keyed,
  entry,
  meals,
  mealsById,
  itemsById,
}: {
  trip: Trip
  dayIndex: number
  person: Person
  keyed: KeyedSlot
  entry: PlanEntry | undefined
  meals: Meal[]
  mealsById: ReadonlyMap<string, Meal>
  itemsById: ReadonlyMap<string, Item>
}) {
  // Vegetarian people only see vegetarian meals (story 1.3).
  const eligible = meals
    .filter((m) => m.type === keyed.slot.type)
    .filter((m) => !person.vegetarian || rollUpMeal(m, itemsById).vegetarian)
    .sort((a, b) => a.name.localeCompare(b.name))

  const value = entry === undefined ? '' : entry.kind === 'offTrail' ? OFF_TRAIL : entry.mealId

  async function onChange(next: string) {
    if (next === '') {
      await clearPlanEntry(trip.id, person.id, dayIndex, keyed.key)
    } else if (next === OFF_TRAIL) {
      await setPlanEntry({
        tripId: trip.id,
        personId: person.id,
        dayIndex,
        slotKey: keyed.key,
        kind: 'offTrail',
      })
    } else {
      await setPlanEntry({
        tripId: trip.id,
        personId: person.id,
        dayIndex,
        slotKey: keyed.key,
        kind: 'meal',
        mealId: next,
      })
    }
  }

  const detail =
    entry && (entry.kind === 'meal' || entry.offTrailCalories != null)
      ? entryTotals(entry, mealsById, itemsById)
      : null

  return (
    <div className="flex items-center gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-1.5">
      <span className="w-32 shrink-0 text-sm text-gray-600">{fmtSlot(keyed.slot)}</span>
      <select
        className="min-w-0 flex-1 rounded border border-gray-300 px-1 py-0.5 text-sm"
        value={value}
        onChange={(e) => void onChange(e.target.value)}
      >
        <option value="">—</option>
        <option value={OFF_TRAIL}>off-trail (restaurant/town)</option>
        {eligible.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      {entry?.kind === 'offTrail' && (
        <input
          className="w-20 rounded border border-gray-300 px-1 py-0.5 text-sm"
          inputMode="numeric"
          placeholder="est. cal"
          defaultValue={entry.offTrailCalories ?? ''}
          onBlur={(e) => {
            const v = e.target.value.trim()
            const cal = Number(v)
            void setPlanEntry({
              tripId: trip.id,
              personId: person.id,
              dayIndex,
              slotKey: keyed.key,
              kind: 'offTrail',
              offTrailCalories: v !== '' && Number.isFinite(cal) && cal >= 0 ? cal : undefined,
            })
          }}
        />
      )}
      {detail && (
        <span className="shrink-0 text-xs tabular-nums text-gray-500">
          {fmtCalories(detail.calories)}
          {detail.weightG > 0 && ` · ${fmtGrams(detail.weightG)}`}
          {entry?.quantityScale != null && entry.quantityScale !== 1 && (
            <span className="text-amber-700"> ×{entry.quantityScale}</span>
          )}
        </span>
      )}
      {entry?.kind === 'meal' && (
        <label
          className="flex shrink-0 items-center gap-0.5 text-xs text-gray-500"
          title="Locked picks survive generation"
        >
          <input
            type="checkbox"
            checked={entry.locked ?? false}
            onChange={(e) => void setPlanEntry({ ...entry, locked: e.target.checked })}
          />
          lock
        </label>
      )}
    </div>
  )
}
