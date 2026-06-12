import { describe, expect, it } from 'vitest'
import { carryEnd, carryStart, deriveCarries } from '../../src/domain/carries'
import { makeTrip, toggleMainSlot } from '../../src/domain/trip'
import type { Resupply, ResupplyTiming } from '../../src/domain/types'

function resupply(dayIndex: number, timing: ResupplyTiming): Resupply {
  return { id: `r${dayIndex}`, tripId: 't1', dayIndex, timing }
}

describe('deriveCarries', () => {
  it('reproduces the 10-day acceptance example from story 3.2', () => {
    // Resupplies: day 3 before brekkie, day 6 after lunch, day 8 late afternoon.
    const trip = makeTrip('t1', 'GR20', 10)
    const carries = deriveCarries(trip, [
      resupply(3, 'before_breakfast'),
      resupply(6, 'after_lunch'),
      resupply(8, 'late_afternoon'),
    ])

    expect(carries).toHaveLength(4)

    // Carry 1: day 1 start → day 2 dinner
    expect(carryStart(carries[0])).toMatchObject({
      dayIndex: 1,
      slot: { type: 'brekkie', timing: 'morning' },
    })
    expect(carryEnd(carries[0])).toMatchObject({
      dayIndex: 2,
      slot: { type: 'dinner', timing: 'evening' },
    })

    // Carry 2: day 3 brekkie → day 6 lunch
    expect(carryStart(carries[1])).toMatchObject({
      dayIndex: 3,
      slot: { type: 'brekkie', timing: 'morning' },
    })
    expect(carryEnd(carries[1])).toMatchObject({
      dayIndex: 6,
      slot: { type: 'lunch', timing: 'midday' },
    })

    // Carry 3: day 6 dinner → day 8 lunch/afternoon snacks.
    // The day-6 afternoon snack follows the after-lunch resupply, so it
    // opens carry 3 (snack-splitting rule); dinner is the first main.
    expect(carryStart(carries[2])).toMatchObject({
      dayIndex: 6,
      slot: { type: 'snack', timing: 'afternoon' },
    })
    expect(carryEnd(carries[2])).toMatchObject({
      dayIndex: 8,
      slot: { type: 'snack', timing: 'afternoon' },
    })

    // Carry 4: day 8 dinner → trip end
    expect(carryStart(carries[3])).toMatchObject({
      dayIndex: 8,
      slot: { type: 'dinner', timing: 'evening' },
    })
    expect(carryEnd(carries[3])).toMatchObject({
      dayIndex: 10,
      slot: { type: 'dinner', timing: 'evening' },
    })
  })

  it('assigns every active slot to exactly one carry', () => {
    const trip = makeTrip('t1', 'GR20', 10)
    const carries = deriveCarries(trip, [
      resupply(3, 'before_breakfast'),
      resupply(6, 'after_lunch'),
      resupply(8, 'late_afternoon'),
    ])
    const totalActiveSlots = trip.days.reduce((n, d) => n + d.activeSlots.length, 0)
    const assigned = carries.flatMap((c) => c.slots)
    expect(assigned).toHaveLength(totalActiveSlots)
  })

  it('splits a day’s snacks around an after-lunch resupply', () => {
    const trip = makeTrip('t1', 'Short', 2)
    const carries = deriveCarries(trip, [resupply(1, 'after_lunch')])
    const [before, after] = carries
    expect(
      before.slots.filter((s) => s.dayIndex === 1).map((s) => s.slot.type),
    ).toEqual(['brekkie', 'snack', 'lunch'])
    expect(
      after.slots.filter((s) => s.dayIndex === 1).map((s) => s.slot.type),
    ).toEqual(['snack', 'dinner'])
  })

  it('returns one carry covering the whole trip when there are no resupplies', () => {
    const trip = makeTrip('t1', 'Weekend', 3)
    const carries = deriveCarries(trip, [])
    expect(carries).toHaveLength(1)
    expect(carryStart(carries[0]).dayIndex).toBe(1)
    expect(carryEnd(carries[0]).dayIndex).toBe(3)
  })

  it('skips inactive slots on partial days', () => {
    const trip = makeTrip('t1', 'Exit early', 3)
    // Last day: off trail by lunch — brekkie + snacks only (story 2.3).
    let lastDay = trip.days[2]
    lastDay = toggleMainSlot(lastDay, 'lunch')
    lastDay = toggleMainSlot(lastDay, 'dinner')
    trip.days[2] = lastDay

    const carries = deriveCarries(trip, [])
    const day3Types = carries[0].slots
      .filter((s) => s.dayIndex === 3)
      .map((s) => s.slot.type)
    expect(day3Types).toEqual(['brekkie', 'snack', 'snack'])
  })

  it('drops empty carries from back-to-back resupplies but keeps indices sequential', () => {
    const trip = makeTrip('t1', 'Town day', 4)
    const carries = deriveCarries(trip, [
      resupply(2, 'before_breakfast'),
      resupply(2, 'before_breakfast'),
    ])
    expect(carries).toHaveLength(2)
    expect(carries.map((c) => c.index)).toEqual([1, 2])
  })
})
