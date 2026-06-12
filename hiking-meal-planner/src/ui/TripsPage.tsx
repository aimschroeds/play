import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../store/db'
import { addPersonToTrip, createTrip, deleteTrip, removePersonFromTrip } from '../store/repos'
import { carryEnd, carryStart, deriveCarries, type SlotRef } from '../domain/carries'
import { scaledDailyTarget } from '../domain/density'
import {
  hasMainSlot,
  snackCount,
  toggleMainSlot,
  withDayCount,
  withSnackCount,
  type MainMealType,
} from '../domain/trip'
import type { Day, DayType, Person, Resupply, ResupplyTiming, Trip } from '../domain/types'
import { fmtCalories, fmtSlot } from './format'
import { VegBadge } from './VegBadge'

const DAY_TYPES: DayType[] = ['small', 'average', 'big', 'huge']
const MAINS: MainMealType[] = ['brekkie', 'lunch', 'dinner']

const RESUPPLY_TIMINGS: { value: ResupplyTiming; label: string }[] = [
  { value: 'before_breakfast', label: 'before brekkie' },
  { value: 'after_lunch', label: 'after lunch' },
  { value: 'late_afternoon', label: 'late afternoon' },
  { value: 'after_dinner', label: 'after dinner' },
]

export function TripsPage() {
  const trips = useLiveQuery(() => db.trips.toArray(), [], [] as Trip[])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [numDays, setNumDays] = useState('7')

  const selected = trips.find((t) => t.id === selectedId)
  if (selected) {
    return <TripDetail trip={selected} onBack={() => setSelectedId(null)} />
  }

  const days = Number(numDays)
  const canCreate = name.trim() !== '' && Number.isInteger(days) && days >= 1

  return (
    <div className="space-y-6">
      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault()
          void createTrip(name.trim(), days).then(setSelectedId)
          setName('')
        }}
      >
        <label className="block">
          <span className="block text-sm text-gray-600">Trip name</span>
          <input
            className="mt-1 rounded border border-gray-300 px-2 py-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="GR20 north"
          />
        </label>
        <label className="block">
          <span className="block text-sm text-gray-600">Days</span>
          <input
            className="mt-1 w-20 rounded border border-gray-300 px-2 py-1"
            inputMode="numeric"
            value={numDays}
            onChange={(e) => setNumDays(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={!canCreate}
          className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Create trip
        </button>
      </form>

      {trips.length === 0 ? (
        <p className="text-sm text-gray-500">No trips yet — create your first above.</p>
      ) : (
        <ul className="space-y-2">
          {trips.map((trip) => (
            <li
              key={trip.id}
              className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3"
            >
              <button
                className="font-medium text-emerald-800 underline"
                onClick={() => setSelectedId(trip.id)}
              >
                {trip.name}
              </button>
              <span className="text-sm text-gray-500">
                {trip.days.length} days · {trip.peopleIds.length} people
              </span>
              <button
                className="text-sm text-red-700 underline"
                onClick={() => void deleteTrip(trip.id)}
              >
                delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TripDetail({ trip, onBack }: { trip: Trip; onBack: () => void }) {
  const people = useLiveQuery(
    () => db.people.where('id').anyOf(trip.peopleIds).toArray(),
    [trip.peopleIds.join()],
    [] as Person[],
  )

  async function update(patch: Partial<Trip>) {
    await db.trips.put({ ...trip, ...patch })
  }

  async function updateDay(updated: Day) {
    await update({ days: trip.days.map((d) => (d.index === updated.index ? updated : d)) })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button className="text-sm text-gray-500 underline" onClick={onBack}>
          ← trips
        </button>
        <h2 className="text-xl font-bold text-gray-800">{trip.name}</h2>
        <label className="ml-auto flex items-center gap-2 text-sm text-gray-600">
          days
          <input
            className="w-16 rounded border border-gray-300 px-2 py-1"
            inputMode="numeric"
            value={trip.days.length}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isInteger(n) && n >= 1 && n <= 60) void update(withDayCount(trip, n))
            }}
          />
        </label>
      </div>

      <PeopleSection trip={trip} people={people} />
      <FactorsSection trip={trip} onUpdate={update} />
      <ResuppliesSection trip={trip} />
      <CarriesSection trip={trip} />

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-2 font-semibold text-gray-800">Days</h3>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-300 text-left text-gray-600">
              <th className="py-1 pr-2">Day</th>
              <th className="py-1 pr-2">Effort</th>
              <th className="py-1 pr-2">Slots</th>
              <th className="py-1 pr-2">Snacks</th>
              {people.map((p) => (
                <th key={p.id} className="py-1 pr-2 text-right">
                  {p.name} target
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trip.days.map((day) => (
              <tr key={day.index} className="border-b border-gray-100">
                <td className="py-1.5 pr-2 font-medium">{day.index}</td>
                <td className="py-1.5 pr-2">
                  <select
                    className="rounded border border-gray-300 px-1 py-0.5"
                    value={day.type}
                    onChange={(e) =>
                      void updateDay({ ...day, type: e.target.value as DayType })
                    }
                  >
                    {DAY_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t} ({trip.dayTypeFactors[t]}×)
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1.5 pr-2">
                  {MAINS.map((m) => (
                    <label key={m} className="mr-3 inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={hasMainSlot(day, m)}
                        onChange={() => void updateDay(toggleMainSlot(day, m))}
                      />
                      {m}
                    </label>
                  ))}
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    className="w-14 rounded border border-gray-300 px-1 py-0.5"
                    inputMode="numeric"
                    value={snackCount(day)}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (Number.isInteger(n) && n >= 0 && n <= 12) {
                        void updateDay(withSnackCount(day, n))
                      }
                    }}
                  />
                </td>
                {people.map((p) => (
                  <td key={p.id} className="py-1.5 pr-2 text-right tabular-nums">
                    {fmtCalories(
                      scaledDailyTarget(p.baselineCalories, trip.dayTypeFactors[day.type]),
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-gray-500">
          Uncheck slots on partial first/last days (e.g. off trail by lunch → brekkie + snacks
          only).
        </p>
      </section>
    </div>
  )
}

function PeopleSection({ trip, people }: { trip: Trip; people: Person[] }) {
  const [name, setName] = useState('')
  const [calories, setCalories] = useState('2500')
  const [vegetarian, setVegetarian] = useState(false)

  const cal = Number(calories)
  const canAdd = name.trim() !== '' && Number.isFinite(cal) && cal > 0

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-2 font-semibold text-gray-800">People</h3>
      {people.length > 0 && (
        <ul className="mb-3 space-y-1">
          {people.map((p) => (
            <li key={p.id} className="flex items-center gap-3 text-sm">
              <span className="font-medium">{p.name}</span>
              <span className="text-gray-500">{fmtCalories(p.baselineCalories)}/day baseline</span>
              <VegBadge vegetarian={p.vegetarian} />
              <button
                className="text-red-700 underline"
                onClick={() => void removePersonFromTrip(trip.id, p.id)}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void addPersonToTrip(trip.id, {
            name: name.trim(),
            baselineCalories: cal,
            vegetarian,
          })
          setName('')
        }}
      >
        <label className="block">
          <span className="block text-sm text-gray-600">Name</span>
          <input
            className="mt-1 rounded border border-gray-300 px-2 py-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="block text-sm text-gray-600">Baseline cal/day</span>
          <input
            className="mt-1 w-24 rounded border border-gray-300 px-2 py-1"
            inputMode="numeric"
            value={calories}
            onChange={(e) => setCalories(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1 pb-1.5">
          <input
            type="checkbox"
            checked={vegetarian}
            onChange={(e) => setVegetarian(e.target.checked)}
          />
          <span className="text-sm text-gray-600">vegetarian</span>
        </label>
        <button
          type="submit"
          disabled={!canAdd}
          className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Add person
        </button>
      </form>
    </section>
  )
}

function ResuppliesSection({ trip }: { trip: Trip }) {
  const resupplies = useLiveQuery(
    () => db.resupplies.where('tripId').equals(trip.id).sortBy('dayIndex'),
    [trip.id],
    [] as Resupply[],
  )
  const [dayIndex, setDayIndex] = useState('1')
  const [timing, setTiming] = useState<ResupplyTiming>('before_breakfast')

  const day = Number(dayIndex)
  const canAdd = Number.isInteger(day) && day >= 1 && day <= trip.days.length

  const timingLabel = (t: ResupplyTiming) =>
    RESUPPLY_TIMINGS.find((rt) => rt.value === t)?.label ?? t

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-2 font-semibold text-gray-800">Resupplies</h3>
      {resupplies.length > 0 && (
        <ul className="mb-3 space-y-1">
          {resupplies.map((r) => (
            <li key={r.id} className="flex items-center gap-3 text-sm">
              <span>
                Day {r.dayIndex}, {timingLabel(r.timing)}
              </span>
              <button
                className="text-red-700 underline"
                onClick={() => void db.resupplies.delete(r.id)}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void db.resupplies.add({
            id: crypto.randomUUID(),
            tripId: trip.id,
            dayIndex: day,
            timing,
          })
        }}
      >
        <label className="block">
          <span className="block text-sm text-gray-600">Day</span>
          <input
            className="mt-1 w-16 rounded border border-gray-300 px-2 py-1"
            inputMode="numeric"
            value={dayIndex}
            onChange={(e) => setDayIndex(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="block text-sm text-gray-600">Timing</span>
          <select
            className="mt-1 rounded border border-gray-300 px-2 py-1"
            value={timing}
            onChange={(e) => setTiming(e.target.value as ResupplyTiming)}
          >
            {RESUPPLY_TIMINGS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={!canAdd}
          className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Add resupply
        </button>
      </form>
    </section>
  )
}

const SLOT_ABBREV: Record<string, string> = {
  brekkie: 'B',
  snack: 'S',
  lunch: 'L',
  dinner: 'D',
}

function CarriesSection({ trip }: { trip: Trip }) {
  const resupplies = useLiveQuery(
    () => db.resupplies.where('tripId').equals(trip.id).toArray(),
    [trip.id],
    [] as Resupply[],
  )
  const carries = deriveCarries(trip, resupplies)

  const fmtRef = (ref: SlotRef) => `day ${ref.dayIndex} ${fmtSlot(ref.slot)}`

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-2 font-semibold text-gray-800">Carries</h3>
      <p className="mb-3 text-xs text-gray-500">
        Derived from resupplies — every slot belongs to exactly one carry. Check the
        boundaries before packing.
      </p>
      <ul className="space-y-3">
        {carries.map((carry) => {
          const byDay = new Map<number, string[]>()
          for (const { dayIndex, slot } of carry.slots) {
            byDay.set(dayIndex, [...(byDay.get(dayIndex) ?? []), SLOT_ABBREV[slot.type]])
          }
          return (
            <li key={carry.index} className="text-sm">
              <span className="font-medium">Carry {carry.index}:</span>{' '}
              {fmtRef(carryStart(carry))} → {fmtRef(carryEnd(carry))}
              <span className="text-gray-500"> · {carry.slots.length} slots</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {[...byDay.entries()].map(([dayIndex, abbrevs]) => (
                  <span
                    key={dayIndex}
                    className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-900"
                  >
                    d{dayIndex}: {abbrevs.join(' ')}
                  </span>
                ))}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function FactorsSection({
  trip,
  onUpdate,
}: {
  trip: Trip
  onUpdate: (patch: Partial<Trip>) => Promise<void>
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-2 font-semibold text-gray-800">Day-type scaling factors</h3>
      <div className="flex flex-wrap gap-4">
        {DAY_TYPES.map((t) => (
          <label key={t} className="block">
            <span className="block text-sm text-gray-600">{t}</span>
            <input
              className="mt-1 w-20 rounded border border-gray-300 px-2 py-1"
              inputMode="decimal"
              defaultValue={trip.dayTypeFactors[t]}
              onBlur={(e) => {
                const v = Number(e.target.value)
                if (Number.isFinite(v) && v > 0) {
                  void onUpdate({ dayTypeFactors: { ...trip.dayTypeFactors, [t]: v } })
                } else {
                  e.target.value = String(trip.dayTypeFactors[t])
                }
              }}
            />
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-500">
        A person's daily target = baseline × factor for the day's effort.
      </p>
    </section>
  )
}
