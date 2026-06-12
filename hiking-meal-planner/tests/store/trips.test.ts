import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/store/db'
import {
  addPersonToTrip,
  createTrip,
  deleteTrip,
  removePersonFromTrip,
} from '../../src/store/repos'

describe('trip & people lifecycle', () => {
  beforeEach(async () => {
    await Promise.all([db.trips.clear(), db.people.clear()])
  })

  it('creates a trip with default days', async () => {
    const id = await createTrip('GR20', 7)
    const trip = await db.trips.get(id)
    expect(trip?.name).toBe('GR20')
    expect(trip?.days).toHaveLength(7)
  })

  it('adds and removes a person, keeping trip.peopleIds in sync', async () => {
    const tripId = await createTrip('GR20', 7)
    const personId = await addPersonToTrip(tripId, {
      name: 'Aimee',
      baselineCalories: 2500,
      vegetarian: true,
    })
    expect((await db.trips.get(tripId))?.peopleIds).toEqual([personId])
    expect((await db.people.get(personId))?.name).toBe('Aimee')

    await removePersonFromTrip(tripId, personId)
    expect((await db.trips.get(tripId))?.peopleIds).toEqual([])
    expect(await db.people.get(personId)).toBeUndefined()
  })

  it('deleting a trip deletes its people', async () => {
    const tripId = await createTrip('GR20', 7)
    const personId = await addPersonToTrip(tripId, {
      name: 'Sam',
      baselineCalories: 3000,
      vegetarian: false,
    })
    await deleteTrip(tripId)
    expect(await db.trips.get(tripId)).toBeUndefined()
    expect(await db.people.get(personId)).toBeUndefined()
  })
})
