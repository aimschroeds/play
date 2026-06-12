// Carry derivation (Epic 3). Carries are always derived from resupply
// points, never stored: every active meal slot belongs to exactly one
// carry (story 3.2).
//
// Snack-splitting rule (resolved open item #1): each slot has a coarse
// timing, and a resupply's timing defines a cut position within the day.
// Slots at/after the cut start the new carry — so morning snacks before
// an after-lunch resupply stay in the old carry, afternoon snacks go to
// the new one.

import type { Day, Resupply, ResupplyTiming, Slot, SlotTiming, Trip } from './types'

export interface SlotRef {
  dayIndex: number
  slot: Slot
  /** Stable key from keyedSlots(), used to join with PlanEntry.slotKey. */
  key: string
}

export interface Carry {
  /** 1-based, in trip order. */
  index: number
  /** Chronologically ordered slots in this carry. */
  slots: SlotRef[]
}

const TIMING_ORDER: Record<SlotTiming, number> = {
  morning: 0,
  midday: 1,
  afternoon: 2,
  evening: 3,
}

/** Chronological position of a slot within its day. Snacks come after a
 *  main meal sharing their timing (brekkie before morning snacks, dinner
 *  before evening snacks). */
export function slotPosition(slot: Slot): number {
  return TIMING_ORDER[slot.timing] * 10 + (slot.type === 'snack' ? 1 : 0)
}

export interface KeyedSlot {
  slot: Slot
  key: string
}

/** A day's active slots in chronological order, each with a stable key:
 *  `type:timing`, suffixed with an occurrence number for duplicates
 *  (e.g. a fourth snack repeats a timing). PlanEntries reference slots
 *  by this key. */
export function keyedSlots(day: Day): KeyedSlot[] {
  const sorted = [...day.activeSlots].sort((a, b) => slotPosition(a) - slotPosition(b))
  const seen = new Map<string, number>()
  return sorted.map((slot) => {
    const base = `${slot.type}:${slot.timing}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return { slot, key: n === 0 ? base : `${base}:${n}` }
  })
}

/** Position within the day at which the new carry starts. */
const CUT_POSITIONS: Record<ResupplyTiming, number> = {
  before_breakfast: 0,
  after_lunch: TIMING_ORDER.midday * 10 + 1, // afternoon snacks onward
  late_afternoon: TIMING_ORDER.evening * 10, // dinner onward
  after_dinner: TIMING_ORDER.evening * 10 + 1, // evening snacks onward
}

export function deriveCarries(trip: Trip, resupplies: Resupply[]): Carry[] {
  const cuts = resupplies
    .map((r) => ({ dayIndex: r.dayIndex, position: CUT_POSITIONS[r.timing] }))
    .sort((a, b) => a.dayIndex - b.dayIndex || a.position - b.position)

  const buckets: SlotRef[][] = Array.from({ length: cuts.length + 1 }, () => [])
  const days = [...trip.days].sort((a, b) => a.index - b.index)
  for (const day of days) {
    for (const { slot, key } of keyedSlots(day)) {
      const cutsPassed = cuts.filter(
        (c) =>
          c.dayIndex < day.index ||
          (c.dayIndex === day.index && slotPosition(slot) >= c.position),
      ).length
      buckets[cutsPassed].push({ dayIndex: day.index, slot, key })
    }
  }

  return buckets
    .filter((slots) => slots.length > 0)
    .map((slots, i) => ({ index: i + 1, slots }))
}

export function carryStart(carry: Carry): SlotRef {
  return carry.slots[0]
}

export function carryEnd(carry: Carry): SlotRef {
  return carry.slots[carry.slots.length - 1]
}
