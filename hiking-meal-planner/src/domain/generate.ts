// Plan generation (Epic 8). A greedy heuristic, not a solver: fill mains
// near typical calorie shares, fill snacks to close the gap, then fine-tune
// with a uniform quantity scale within bounds (resolved open item #3:
// 0.5×–1.5× of the source meal). Injected rng picks among the top
// candidates so "regenerate" (story 8.3) varies.

import { keyedSlots, type KeyedSlot } from './carries'
import { scaledDailyTarget } from './density'
import { rollUpMeal, type MealRollup } from './rollups'
import { entryTotals } from './totals'
import type { Day, Item, Meal, MealType, Person, PlanEntry, Trip } from './types'

export const DEFAULT_SCALE_BOUNDS = { min: 0.5, max: 1.5 }

/** Typical share of a day's calories per main; snacks share the rest. */
const MAIN_SHARES: Record<string, number> = { brekkie: 0.25, lunch: 0.3, dinner: 0.35 }
const SNACK_SHARE = 0.1

/** How many top-scored candidates the rng picks among. */
const VARIETY = 3

export type GeneratedEntry = Omit<PlanEntry, 'id'>

export function generateDayPlan(args: {
  trip: Trip
  day: Day
  person: Person
  meals: Meal[]
  itemsById: ReadonlyMap<string, Item>
  /** This person's existing entries for this day. Locked picks and
   *  off-trail slots are kept and generated around (stories 8.1, 8.2). */
  existingEntries: PlanEntry[]
  rng: () => number
  scaleBounds?: { min: number; max: number }
}): GeneratedEntry[] {
  const { trip, day, person, meals, itemsById, existingEntries, rng } = args
  const bounds = args.scaleBounds ?? DEFAULT_SCALE_BOUNDS

  const byKey = new Map(existingEntries.map((e) => [e.slotKey, e]))
  const kept: PlanEntry[] = []
  const open: KeyedSlot[] = []
  for (const ks of keyedSlots(day)) {
    const existing = byKey.get(ks.key)
    if (existing && (existing.locked || existing.kind === 'offTrail')) kept.push(existing)
    else open.push(ks)
  }

  const target = scaledDailyTarget(person.baselineCalories, trip.dayTypeFactors[day.type])
  const keptCalories = kept.reduce(
    (n, e) => n + entryTotals(e, new Map(meals.map((m) => [m.id, m])), itemsById).calories,
    0,
  )
  const remaining = Math.max(0, target - keptCalories)

  const candidatesByType = new Map<MealType, { meal: Meal; rollup: MealRollup }[]>()
  const eligible = (type: MealType) => {
    let list = candidatesByType.get(type)
    if (!list) {
      // Only vegetarian meals for vegetarian people (story 8.1).
      list = meals
        .filter((m) => m.type === type)
        .map((meal) => ({ meal, rollup: rollUpMeal(meal, itemsById) }))
        .filter(({ rollup }) => rollup.calories > 0)
        .filter(({ rollup }) => !person.vegetarian || rollup.vegetarian)
      candidatesByType.set(type, list)
    }
    return list
  }

  // Closest to the slot target wins; density breaks ties so the heuristic
  // leans toward lighter packs.
  const pick = (type: MealType, slotTarget: number) => {
    const scored = eligible(type)
      .map((c) => ({ ...c, score: Math.abs(c.rollup.calories - slotTarget) }))
      .sort((a, b) => a.score - b.score || b.rollup.density - a.rollup.density)
    const top = scored.slice(0, VARIETY)
    return top.length > 0 ? top[Math.floor(rng() * top.length)] : null
  }

  const openMains = open.filter((s) => s.slot.type !== 'snack')
  const openSnacks = open.filter((s) => s.slot.type === 'snack')
  const shareSum =
    openMains.reduce((n, s) => n + MAIN_SHARES[s.slot.type], 0) +
    openSnacks.length * SNACK_SHARE

  const chosen: { ks: KeyedSlot; meal: Meal; calories: number }[] = []
  for (const ks of openMains) {
    const slotTarget = shareSum > 0 ? remaining * (MAIN_SHARES[ks.slot.type] / shareSum) : 0
    const c = pick(ks.slot.type, slotTarget)
    if (c) chosen.push({ ks, meal: c.meal, calories: c.rollup.calories })
  }

  // Snacks close whatever gap the mains left (story 8.1).
  let gap = remaining - chosen.reduce((n, c) => n + c.calories, 0)
  for (let i = 0; i < openSnacks.length && gap > 0; i++) {
    const slotTarget = gap / (openSnacks.length - i)
    const c = pick('snack', slotTarget)
    if (!c) break
    chosen.push({ ks: openSnacks[i], meal: c.meal, calories: c.rollup.calories })
    gap -= c.rollup.calories
  }

  // Fine-tune: one uniform quantity scale on the generated entries.
  const generatedCalories = chosen.reduce((n, c) => n + c.calories, 0)
  const rawScale = generatedCalories > 0 ? remaining / generatedCalories : 1
  const scale = Math.round(Math.min(bounds.max, Math.max(bounds.min, rawScale)) * 100) / 100

  return chosen.map(({ ks, meal }) => ({
    tripId: trip.id,
    personId: person.id,
    dayIndex: day.index,
    slotKey: ks.key,
    kind: 'meal' as const,
    mealId: meal.id,
    quantityScale: scale === 1 ? undefined : scale,
    locked: false,
  }))
}
