import { describe, expect, it } from 'vitest'
import { generateDayPlan } from '../../src/domain/generate'
import { makeTrip } from '../../src/domain/trip'
import type { Item, Meal, Person, PlanEntry } from '../../src/domain/types'

function item(id: string, caloriesPerGram: number, vegetarian = true): Item {
  return {
    id,
    name: id,
    caloriesPerGram,
    vegetarian,
    inputBasis: 'per_gram',
    inputWeightG: 1,
    inputCalories: caloriesPerGram,
  }
}

function meal(id: string, type: Meal['type'], itemId: string, grams: number): Meal {
  return { id, name: id, type, components: [{ itemId, grams }] }
}

// Densities: oats 4, tortilla 4, pasta 4, bar 5, nuts 6, salami 5 (non-veg)
const items = [
  item('oats', 4),
  item('tortilla', 4),
  item('pasta', 4),
  item('bar', 5),
  item('nuts', 6),
  item('salami', 5, false),
]
const itemsById = new Map(items.map((i) => [i.id, i]))

const library: Meal[] = [
  meal('porridge', 'brekkie', 'oats', 100), // 400 cal
  meal('wrap', 'lunch', 'tortilla', 150), // 600 cal
  meal('pasta-night', 'dinner', 'pasta', 200), // 800 cal
  meal('salami-dinner', 'dinner', 'salami', 180), // 900 cal, non-veg
  meal('snack-bar', 'snack', 'bar', 50), // 250 cal
  meal('trail-nuts', 'snack', 'nuts', 50), // 300 cal
]

const person: Person = { id: 'p1', name: 'A', baselineCalories: 2500, vegetarian: false }
const veggie: Person = { id: 'p2', name: 'V', baselineCalories: 2500, vegetarian: true }

const trip = makeTrip('t1', 'Test', 3)
const day = trip.days[0] // average: brekkie, lunch, dinner + 2 snacks

const firstPick = () => 0 // deterministic: always the best-scored candidate

function baseArgs(overrides: Partial<Parameters<typeof generateDayPlan>[0]> = {}) {
  return {
    trip,
    day,
    person,
    meals: library,
    itemsById,
    existingEntries: [] as PlanEntry[],
    rng: firstPick,
    ...overrides,
  }
}

function totalCalories(entries: ReturnType<typeof generateDayPlan>): number {
  return entries.reduce((sum, e) => {
    const m = library.find((x) => x.id === e.mealId)!
    const cal = m.components.reduce(
      (n, c) => n + c.grams * itemsById.get(c.itemId)!.caloriesPerGram,
      0,
    )
    return sum + cal * (e.quantityScale ?? 1)
  }, 0)
}

describe('generateDayPlan', () => {
  it('fills every slot with a type-matched meal and hits the target within 5% (story 8.1)', () => {
    const entries = generateDayPlan(baseArgs())
    expect(entries).toHaveLength(5)
    const byKey = new Map(entries.map((e) => [e.slotKey, e]))
    expect(byKey.get('brekkie:morning')?.mealId).toBe('porridge')
    expect(byKey.get('lunch:midday')?.mealId).toBe('wrap')
    expect(['pasta-night', 'salami-dinner']).toContain(byKey.get('dinner:evening')?.mealId)

    const total = totalCalories(entries)
    expect(Math.abs(total - 2500) / 2500).toBeLessThanOrEqual(0.05)
  })

  it('only selects vegetarian meals for vegetarian people', () => {
    // Run with every rng value that selects different candidates.
    for (const r of [0, 0.4, 0.9]) {
      const entries = generateDayPlan(baseArgs({ person: veggie, rng: () => r }))
      expect(entries.map((e) => e.mealId)).not.toContain('salami-dinner')
    }
  })

  it('keeps locked picks and generates around them (story 8.2)', () => {
    const locked: PlanEntry = {
      id: 'x',
      tripId: 't1',
      personId: 'p1',
      dayIndex: 1,
      slotKey: 'dinner:evening',
      kind: 'meal',
      mealId: 'salami-dinner', // 900 cal kept
      locked: true,
    }
    const entries = generateDayPlan(baseArgs({ existingEntries: [locked] }))
    expect(entries.map((e) => e.slotKey)).not.toContain('dinner:evening')
    // Generated portion aims at 2500 - 900 = 1600.
    const total = totalCalories(entries)
    expect(Math.abs(total - 1600) / 1600).toBeLessThanOrEqual(0.05)
  })

  it('skips off-trail slots (story 8.1)', () => {
    const offTrail: PlanEntry = {
      id: 'x',
      tripId: 't1',
      personId: 'p1',
      dayIndex: 1,
      slotKey: 'lunch:midday',
      kind: 'offTrail',
      offTrailCalories: 700,
    }
    const entries = generateDayPlan(baseArgs({ existingEntries: [offTrail] }))
    expect(entries.map((e) => e.slotKey)).not.toContain('lunch:midday')
  })

  it('replaces unlocked existing picks', () => {
    const unlocked: PlanEntry = {
      id: 'x',
      tripId: 't1',
      personId: 'p1',
      dayIndex: 1,
      slotKey: 'brekkie:morning',
      kind: 'meal',
      mealId: 'porridge',
    }
    const entries = generateDayPlan(baseArgs({ existingEntries: [unlocked] }))
    expect(entries.map((e) => e.slotKey)).toContain('brekkie:morning')
  })

  it('clamps quantity scaling to the bounds instead of producing absurd portions', () => {
    const hungry: Person = { id: 'p3', name: 'H', baselineCalories: 6000, vegetarian: false }
    const entries = generateDayPlan(baseArgs({ person: hungry }))
    for (const e of entries) {
      expect(e.quantityScale ?? 1).toBeLessThanOrEqual(1.5)
      expect(e.quantityScale ?? 1).toBeGreaterThanOrEqual(0.5)
    }
  })

  it('leaves slots unfilled when no eligible meal exists', () => {
    const noBrekkie = library.filter((m) => m.type !== 'brekkie')
    const entries = generateDayPlan(baseArgs({ meals: noBrekkie }))
    expect(entries.map((e) => e.slotKey)).not.toContain('brekkie:morning')
  })

  it('varies picks with the rng for one-tap regeneration (story 8.3)', () => {
    const a = generateDayPlan(baseArgs({ rng: () => 0 }))
    const b = generateDayPlan(baseArgs({ rng: () => 0.99 }))
    expect(a.map((e) => e.mealId).join()).not.toEqual(b.map((e) => e.mealId).join())
  })
})
