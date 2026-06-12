import { describe, expect, it } from 'vitest'
import { deriveCarries } from '../../src/domain/carries'
import { carryTotals, dayTotals, entryTotals, planKey } from '../../src/domain/totals'
import { makeTrip } from '../../src/domain/trip'
import type { Item, Meal, Person, PlanEntry } from '../../src/domain/types'

const oats: Item = {
  id: 'oats',
  name: 'Oatmeal',
  caloriesPerGram: 4,
  vegetarian: true,
  inputBasis: 'per_100g',
  inputWeightG: 100,
  inputCalories: 400,
}
const bar: Item = {
  id: 'bar',
  name: 'Snack bar',
  caloriesPerGram: 5,
  vegetarian: true,
  inputBasis: 'per_package',
  inputWeightG: 50,
  inputCalories: 250,
}
const itemsById = new Map([oats, bar].map((i) => [i.id, i]))

const porridge: Meal = {
  id: 'porridge',
  name: 'Porridge',
  type: 'brekkie',
  components: [{ itemId: 'oats', grams: 100 }], // 100g, 400 cal
}
const barMeal: Meal = {
  id: 'barMeal',
  name: 'Snack bar',
  type: 'snack',
  components: [{ itemId: 'bar', grams: 50 }], // 50g, 250 cal
}
const mealsById = new Map([porridge, barMeal].map((m) => [m.id, m]))

const person: Person = { id: 'p1', name: 'A', baselineCalories: 1000, vegetarian: false }

function entry(partial: Partial<PlanEntry> & Pick<PlanEntry, 'slotKey' | 'kind'>): PlanEntry {
  return {
    id: `t|p1|1|${partial.slotKey}`,
    tripId: 't',
    personId: 'p1',
    dayIndex: 1,
    ...partial,
  }
}

describe('entryTotals', () => {
  it('scales meal quantities by quantityScale', () => {
    const t = entryTotals(
      entry({ slotKey: 'brekkie:morning', kind: 'meal', mealId: 'porridge', quantityScale: 1.5 }),
      mealsById,
      itemsById,
    )
    expect(t.weightG).toBe(150)
    expect(t.calories).toBe(600)
  })

  it('off-trail meals weigh nothing and use the optional estimate', () => {
    const estimated = entryTotals(
      entry({ slotKey: 'dinner:evening', kind: 'offTrail', offTrailCalories: 900 }),
      mealsById,
      itemsById,
    )
    expect(estimated).toEqual({ weightG: 0, calories: 900, unestimated: false })

    const unestimated = entryTotals(
      entry({ slotKey: 'dinner:evening', kind: 'offTrail' }),
      mealsById,
      itemsById,
    )
    expect(unestimated).toEqual({ weightG: 0, calories: 0, unestimated: true })
  })
})

describe('dayTotals', () => {
  const trip = makeTrip('t', 'Test', 2)
  const base = {
    day: trip.days[0],
    person,
    factors: trip.dayTypeFactors,
    mealsById,
    itemsById,
  }

  it('reports totals and target delta (story 7.1)', () => {
    const totals = dayTotals({
      ...base,
      entries: [
        entry({ slotKey: 'brekkie:morning', kind: 'meal', mealId: 'porridge' }),
        entry({ slotKey: 'snack:morning', kind: 'meal', mealId: 'barMeal' }),
        entry({ slotKey: 'snack:afternoon', kind: 'meal', mealId: 'barMeal' }),
      ],
    })
    expect(totals.calories).toBe(900) // 400 + 250 + 250
    expect(totals.weightG).toBe(200)
    expect(totals.target).toBe(1000)
    expect(totals.delta).toBe(-100)
    expect(totals.deltaPct).toBeCloseTo(-0.1)
    expect(totals.status).toBe('under')
  })

  it('is ok within the tolerance', () => {
    const totals = dayTotals({
      ...base,
      entries: [
        entry({ slotKey: 'brekkie:morning', kind: 'meal', mealId: 'porridge' }),
        entry({ slotKey: 'snack:morning', kind: 'meal', mealId: 'barMeal' }),
        entry({ slotKey: 'snack:afternoon', kind: 'meal', mealId: 'barMeal' }),
        entry({ slotKey: 'lunch:midday', kind: 'offTrail', offTrailCalories: 130 }),
      ],
    })
    expect(totals.calories).toBe(1030)
    expect(totals.status).toBe('ok')
  })

  it('flags overshoot beyond tolerance', () => {
    const totals = dayTotals({
      ...base,
      entries: [
        entry({ slotKey: 'brekkie:morning', kind: 'meal', mealId: 'porridge', quantityScale: 3 }),
      ],
    })
    expect(totals.status).toBe('over')
  })

  it('marks a short day with an unestimated off-trail meal as partial, not under', () => {
    const totals = dayTotals({
      ...base,
      entries: [
        entry({ slotKey: 'brekkie:morning', kind: 'meal', mealId: 'porridge' }),
        entry({ slotKey: 'dinner:evening', kind: 'offTrail' }),
      ],
    })
    expect(totals.unestimatedOffTrail).toBe(true)
    expect(totals.status).toBe('partial')
  })

  it('scales the target by the day type factor', () => {
    const bigDay = { ...trip.days[0], type: 'big' as const }
    const totals = dayTotals({ ...base, day: bigDay, entries: [] })
    expect(totals.target).toBe(1250)
  })
})

describe('carryTotals', () => {
  it('sums weight/calories per person and for the group, off-trail weightless (story 7.2)', () => {
    const trip = makeTrip('t', 'Test', 2)
    const [carry] = deriveCarries(trip, [])

    const entries = [
      entry({ slotKey: 'brekkie:morning', kind: 'meal', mealId: 'porridge' }), // p1 d1
      entry({ slotKey: 'brekkie:morning', kind: 'meal', mealId: 'porridge', dayIndex: 2, id: 'x1' }),
      entry({ slotKey: 'dinner:evening', kind: 'offTrail', offTrailCalories: 800 }), // p1 d1
      entry({ slotKey: 'snack:morning', kind: 'meal', mealId: 'barMeal', personId: 'p2', id: 'x2' }),
    ]
    const entriesByKey = new Map(
      entries.map((e) => [planKey(e.personId, e.dayIndex, e.slotKey), e]),
    )

    const totals = carryTotals({
      carry,
      personIds: ['p1', 'p2'],
      entriesByKey,
      mealsById,
      itemsById,
    })

    const p1Totals = totals.perPerson.get('p1')!
    expect(p1Totals.weightG).toBe(200) // two porridges; off-trail dinner weighs 0
    expect(p1Totals.calories).toBe(1600) // 400 + 400 + 800
    expect(p1Totals.density).toBeCloseTo(8)

    const p2Totals = totals.perPerson.get('p2')!
    expect(p2Totals).toEqual({ weightG: 50, calories: 250, density: 5 })

    expect(totals.group.weightG).toBe(250)
    expect(totals.group.calories).toBe(1850)
  })
})
