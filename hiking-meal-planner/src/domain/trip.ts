// Trip construction and day-slot helpers (Epics 1 & 2).
// Partial first/last days are modeled by selecting which slots apply
// (resolved decision; story 2.3) — no fractional multiplier.

import {
  DEFAULT_DAY_TYPE_FACTORS,
  type Day,
  type Slot,
  type SlotTiming,
  type Trip,
} from './types'

const SNACK_TIMINGS: SlotTiming[] = ['morning', 'afternoon', 'evening']

/** Snack slots cycle morning → afternoon → evening so mid-day resupplies
 *  can split them across carries (PLAN.md §6.1). */
export function snackSlots(count: number): Slot[] {
  return Array.from({ length: count }, (_, i) => ({
    type: 'snack' as const,
    timing: SNACK_TIMINGS[i % SNACK_TIMINGS.length],
  }))
}

export function defaultDaySlots(snackCount = 2): Slot[] {
  return [
    { type: 'brekkie', timing: 'morning' },
    { type: 'lunch', timing: 'midday' },
    { type: 'dinner', timing: 'evening' },
    ...snackSlots(snackCount),
  ]
}

function makeDay(index: number): Day {
  return { index, type: 'average', activeSlots: defaultDaySlots() }
}

export function makeTrip(id: string, name: string, numDays: number): Trip {
  if (!Number.isInteger(numDays) || numDays < 1) {
    throw new RangeError(`numDays must be a positive integer, got ${numDays}`)
  }
  return {
    id,
    name,
    days: Array.from({ length: numDays }, (_, i) => makeDay(i + 1)),
    peopleIds: [],
    dayTypeFactors: { ...DEFAULT_DAY_TYPE_FACTORS },
  }
}

export type MainMealType = 'brekkie' | 'lunch' | 'dinner'

const MAIN_SLOT_TIMINGS: Record<MainMealType, SlotTiming> = {
  brekkie: 'morning',
  lunch: 'midday',
  dinner: 'evening',
}

export function hasMainSlot(day: Day, type: MainMealType): boolean {
  return day.activeSlots.some((s) => s.type === type)
}

export function snackCount(day: Day): number {
  return day.activeSlots.filter((s) => s.type === 'snack').length
}

/** Add or remove a main meal slot — how partial days are edited (story 2.3). */
export function toggleMainSlot(day: Day, type: MainMealType): Day {
  const activeSlots = hasMainSlot(day, type)
    ? day.activeSlots.filter((s) => s.type !== type)
    : [...day.activeSlots, { type, timing: MAIN_SLOT_TIMINGS[type] }]
  return { ...day, activeSlots }
}

export function withSnackCount(day: Day, count: number): Day {
  return {
    ...day,
    activeSlots: [...day.activeSlots.filter((s) => s.type !== 'snack'), ...snackSlots(count)],
  }
}

/** Resize a trip, preserving existing day configuration where possible. */
export function withDayCount(trip: Trip, numDays: number): Trip {
  if (!Number.isInteger(numDays) || numDays < 1) {
    throw new RangeError(`numDays must be a positive integer, got ${numDays}`)
  }
  const days =
    numDays <= trip.days.length
      ? trip.days.slice(0, numDays)
      : [
          ...trip.days,
          ...Array.from({ length: numDays - trip.days.length }, (_, i) =>
            makeDay(trip.days.length + i + 1),
          ),
        ]
  return { ...trip, days }
}
