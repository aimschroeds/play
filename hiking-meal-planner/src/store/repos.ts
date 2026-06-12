// Write operations with referential-integrity checks (story 4.6).
// Resolved decision: deleting an in-use item is BLOCKED, with the list of
// dependents reported so the user can untangle them first.

import { db } from './db'
import { makeTrip } from '../domain/trip'
import type { Item, Meal, Person, PlanEntry } from '../domain/types'

export class ItemInUseError extends Error {
  readonly item: Item
  readonly usedBy: Meal[]

  constructor(item: Item, usedBy: Meal[]) {
    super(
      `"${item.name}" is used by ${usedBy.length} meal${usedBy.length === 1 ? '' : 's'}: ` +
        usedBy.map((m) => m.name).join(', '),
    )
    this.name = 'ItemInUseError'
    this.item = item
    this.usedBy = usedBy
  }
}

export async function deleteItem(id: string): Promise<void> {
  await db.transaction('rw', db.items, db.meals, async () => {
    const item = await db.items.get(id)
    if (!item) return
    const usedBy = await db.meals
      .filter((m) => m.components.some((c) => c.itemId === id))
      .toArray()
    if (usedBy.length > 0) throw new ItemInUseError(item, usedBy)
    await db.items.delete(id)
  })
}

export class MealInUseError extends Error {
  readonly meal: Meal
  readonly entryCount: number

  constructor(meal: Meal, entryCount: number) {
    super(
      `"${meal.name}" is planned in ${entryCount} slot${entryCount === 1 ? '' : 's'} — ` +
        'remove it from plans first',
    )
    this.name = 'MealInUseError'
    this.meal = meal
    this.entryCount = entryCount
  }
}

export async function deleteMeal(id: string): Promise<void> {
  await db.transaction('rw', db.meals, db.planEntries, async () => {
    const meal = await db.meals.get(id)
    if (!meal) return
    const entryCount = await db.planEntries.where('mealId').equals(id).count()
    if (entryCount > 0) throw new MealInUseError(meal, entryCount)
    await db.meals.delete(id)
  })
}

function planEntryId(tripId: string, personId: string, dayIndex: number, slotKey: string) {
  return `${tripId}|${personId}|${dayIndex}|${slotKey}`
}

/** Upsert the assignment for one slot; pass null fields via clearPlanEntry. */
export async function setPlanEntry(
  fields: Omit<PlanEntry, 'id'>,
): Promise<void> {
  await db.planEntries.put({
    ...fields,
    id: planEntryId(fields.tripId, fields.personId, fields.dayIndex, fields.slotKey),
  })
}

export async function clearPlanEntry(
  tripId: string,
  personId: string,
  dayIndex: number,
  slotKey: string,
): Promise<void> {
  await db.planEntries.delete(planEntryId(tripId, personId, dayIndex, slotKey))
}

export async function createTrip(name: string, numDays: number): Promise<string> {
  const trip = makeTrip(crypto.randomUUID(), name, numDays)
  await db.trips.add(trip)
  return trip.id
}

/** People belong to exactly one trip (plans are fully individual, story 5.3),
 *  so deleting a trip deletes its people, resupplies, and plan entries. */
export async function deleteTrip(id: string): Promise<void> {
  await db.transaction('rw', db.trips, db.people, db.resupplies, db.planEntries, async () => {
    const trip = await db.trips.get(id)
    if (!trip) return
    await db.people.bulkDelete(trip.peopleIds)
    await db.resupplies.where('tripId').equals(id).delete()
    await db.planEntries.where('tripId').equals(id).delete()
    await db.trips.delete(id)
  })
}

export async function addPersonToTrip(
  tripId: string,
  fields: Omit<Person, 'id'>,
): Promise<string> {
  const person: Person = { id: crypto.randomUUID(), ...fields }
  await db.transaction('rw', db.trips, db.people, async () => {
    const trip = await db.trips.get(tripId)
    if (!trip) throw new Error(`Trip ${tripId} not found`)
    await db.people.add(person)
    await db.trips.put({ ...trip, peopleIds: [...trip.peopleIds, person.id] })
  })
  return person.id
}

export async function removePersonFromTrip(tripId: string, personId: string): Promise<void> {
  await db.transaction('rw', db.trips, db.people, db.planEntries, async () => {
    const trip = await db.trips.get(tripId)
    if (trip) {
      await db.trips.put({
        ...trip,
        peopleIds: trip.peopleIds.filter((id) => id !== personId),
      })
    }
    await db.planEntries.where('[tripId+personId]').equals([tripId, personId]).delete()
    await db.people.delete(personId)
  })
}
