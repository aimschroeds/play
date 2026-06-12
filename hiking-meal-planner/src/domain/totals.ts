// Day, carry, and trip summaries (Epic 7). All totals are derived from
// plan entries + the library; nothing is stored.

import { rollUpMeal } from './rollups'
import { scaledDailyTarget } from './density'
import type { Carry } from './carries'
import type { Day, DayType, Item, Meal, Person, PlanEntry } from './types'

export const DEFAULT_TOLERANCE = 0.05

/** Lookup key for a plan entry within a trip. */
export function planKey(personId: string, dayIndex: number, slotKey: string): string {
  return `${personId}|${dayIndex}|${slotKey}`
}

export interface EntryTotals {
  weightG: number
  calories: number
  /** Off-trail with no calorie estimate (story 6.2). */
  unestimated: boolean
}

export function entryTotals(
  entry: PlanEntry,
  mealsById: ReadonlyMap<string, Meal>,
  itemsById: ReadonlyMap<string, Item>,
): EntryTotals {
  if (entry.kind === 'offTrail') {
    // Off-trail meals contribute zero weight to any carry.
    return {
      weightG: 0,
      calories: entry.offTrailCalories ?? 0,
      unestimated: entry.offTrailCalories == null,
    }
  }
  const meal = mealsById.get(entry.mealId ?? '')
  if (!meal) throw new Error(`Plan entry ${entry.id} references missing meal ${entry.mealId}`)
  const rollup = rollUpMeal(meal, itemsById)
  const scale = entry.quantityScale ?? 1
  return { weightG: rollup.weightG * scale, calories: rollup.calories * scale, unestimated: false }
}

export type DayStatus = 'ok' | 'under' | 'over' | 'partial'

export interface DayTotals {
  calories: number
  weightG: number
  target: number
  /** calories - target */
  delta: number
  /** delta / target */
  deltaPct: number
  unestimatedOffTrail: boolean
  status: DayStatus
}

export function dayTotals(args: {
  day: Day
  person: Person
  factors: Record<DayType, number>
  /** This person's entries for this day. */
  entries: PlanEntry[]
  mealsById: ReadonlyMap<string, Meal>
  itemsById: ReadonlyMap<string, Item>
  tolerance?: number
}): DayTotals {
  const { day, person, factors, entries, mealsById, itemsById } = args
  const tolerance = args.tolerance ?? DEFAULT_TOLERANCE

  let calories = 0
  let weightG = 0
  let unestimatedOffTrail = false
  for (const entry of entries) {
    const t = entryTotals(entry, mealsById, itemsById)
    calories += t.calories
    weightG += t.weightG
    unestimatedOffTrail ||= t.unestimated
  }

  const target = scaledDailyTarget(person.baselineCalories, factors[day.type])
  const delta = calories - target
  const deltaPct = target > 0 ? delta / target : 0

  let status: DayStatus = 'ok'
  if (deltaPct < -tolerance) {
    // A day missing only an off-trail estimate is "partially estimated",
    // not under target (story 6.2).
    status = unestimatedOffTrail ? 'partial' : 'under'
  } else if (deltaPct > tolerance) {
    status = 'over'
  }

  return { calories, weightG, target, delta, deltaPct, unestimatedOffTrail, status }
}

export interface MassTotals {
  weightG: number
  calories: number
  /** Average cal/g of on-trail food; 0 when weightless. */
  density: number
}

export const EMPTY_MASS: MassTotals = { weightG: 0, calories: 0, density: 0 }

function withDensity(weightG: number, calories: number): MassTotals {
  return { weightG, calories, density: weightG > 0 ? calories / weightG : 0 }
}

export function combineTotals(totals: MassTotals[]): MassTotals {
  const weightG = totals.reduce((n, t) => n + t.weightG, 0)
  const calories = totals.reduce((n, t) => n + t.calories, 0)
  return withDensity(weightG, calories)
}

export interface CarryTotals {
  perPerson: Map<string, MassTotals>
  group: MassTotals
}

/** What's on each back between resupplies (story 7.2). */
export function carryTotals(args: {
  carry: Carry
  personIds: string[]
  /** All of the trip's entries, keyed by planKey(). */
  entriesByKey: ReadonlyMap<string, PlanEntry>
  mealsById: ReadonlyMap<string, Meal>
  itemsById: ReadonlyMap<string, Item>
}): CarryTotals {
  const { carry, personIds, entriesByKey, mealsById, itemsById } = args
  const perPerson = new Map<string, MassTotals>()
  for (const personId of personIds) {
    let weightG = 0
    let calories = 0
    for (const ref of carry.slots) {
      const entry = entriesByKey.get(planKey(personId, ref.dayIndex, ref.key))
      if (!entry) continue
      const t = entryTotals(entry, mealsById, itemsById)
      weightG += t.weightG
      calories += t.calories
    }
    perPerson.set(personId, withDensity(weightG, calories))
  }
  return { perPerson, group: combineTotals([...perPerson.values()]) }
}
