import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/store/db'
import {
  addPersonToTrip,
  clearPlanEntry,
  createTrip,
  deleteMeal,
  MealInUseError,
  removePersonFromTrip,
  setPlanEntry,
} from '../../src/store/repos'
import type { Meal } from '../../src/domain/types'

const porridge: Meal = {
  id: 'porridge',
  name: 'Porridge',
  type: 'brekkie',
  components: [],
}

describe('plan entries', () => {
  let tripId: string
  let personId: string

  beforeEach(async () => {
    await Promise.all([
      db.trips.clear(),
      db.people.clear(),
      db.meals.clear(),
      db.planEntries.clear(),
    ])
    await db.meals.add(porridge)
    tripId = await createTrip('Test', 3)
    personId = await addPersonToTrip(tripId, {
      name: 'A',
      baselineCalories: 2500,
      vegetarian: false,
    })
  })

  it('upserts: assigning the same slot twice keeps one entry', async () => {
    const fields = {
      tripId,
      personId,
      dayIndex: 1,
      slotKey: 'brekkie:morning',
      kind: 'meal' as const,
      mealId: 'porridge',
    }
    await setPlanEntry(fields)
    await setPlanEntry({ ...fields, kind: 'offTrail', mealId: undefined })
    const entries = await db.planEntries.where('tripId').equals(tripId).toArray()
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe('offTrail')
  })

  it('clears a slot', async () => {
    await setPlanEntry({
      tripId,
      personId,
      dayIndex: 1,
      slotKey: 'brekkie:morning',
      kind: 'meal',
      mealId: 'porridge',
    })
    await clearPlanEntry(tripId, personId, 1, 'brekkie:morning')
    expect(await db.planEntries.count()).toBe(0)
  })

  it('blocks deleting a meal that is planned (story 4.6)', async () => {
    await setPlanEntry({
      tripId,
      personId,
      dayIndex: 2,
      slotKey: 'brekkie:morning',
      kind: 'meal',
      mealId: 'porridge',
    })
    const err = await deleteMeal('porridge').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MealInUseError)
    await expect(db.meals.get('porridge')).resolves.toBeDefined()
  })

  it('removing a person deletes their plan entries', async () => {
    await setPlanEntry({
      tripId,
      personId,
      dayIndex: 1,
      slotKey: 'dinner:evening',
      kind: 'meal',
      mealId: 'porridge',
    })
    await removePersonFromTrip(tripId, personId)
    expect(await db.planEntries.count()).toBe(0)
  })
})
