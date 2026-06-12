// Write operations with referential-integrity checks (story 4.6).
// Resolved decision: deleting an in-use item is BLOCKED, with the list of
// dependents reported so the user can untangle them first.

import { db } from './db'
import { makeTrip } from '../domain/trip'
import type { Item, Meal, Person } from '../domain/types'

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

export async function deleteMeal(id: string): Promise<void> {
  // Will also need an in-use check against plan entries once plans exist (M4).
  await db.meals.delete(id)
}

export async function createTrip(name: string, numDays: number): Promise<string> {
  const trip = makeTrip(crypto.randomUUID(), name, numDays)
  await db.trips.add(trip)
  return trip.id
}

/** People belong to exactly one trip (plans are fully individual, story 5.3),
 *  so deleting a trip deletes its people. */
export async function deleteTrip(id: string): Promise<void> {
  await db.transaction('rw', db.trips, db.people, async () => {
    const trip = await db.trips.get(id)
    if (!trip) return
    await db.people.bulkDelete(trip.peopleIds)
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
  await db.transaction('rw', db.trips, db.people, async () => {
    const trip = await db.trips.get(tripId)
    if (trip) {
      await db.trips.put({
        ...trip,
        peopleIds: trip.peopleIds.filter((id) => id !== personId),
      })
    }
    await db.people.delete(personId)
  })
}
