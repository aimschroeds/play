import { describe, expect, it } from 'vitest'
import { defaultDaySlots, makeTrip, snackSlots, withDayCount } from '../../src/domain/trip'
import { DEFAULT_DAY_TYPE_FACTORS } from '../../src/domain/types'

describe('makeTrip', () => {
  it('creates the requested number of average days with full slots', () => {
    const trip = makeTrip('t1', 'GR20', 10)
    expect(trip.days).toHaveLength(10)
    expect(trip.days[0].index).toBe(1)
    expect(trip.days[9].index).toBe(10)
    expect(trip.days.every((d) => d.type === 'average')).toBe(true)
    expect(trip.dayTypeFactors).toEqual(DEFAULT_DAY_TYPE_FACTORS)
  })

  it('default day slots are brekkie, lunch, dinner + 2 snacks', () => {
    const types = defaultDaySlots().map((s) => s.type)
    expect(types).toEqual(['brekkie', 'lunch', 'dinner', 'snack', 'snack'])
  })

  it.each([0, -1, 2.5])('rejects numDays = %s', (n) => {
    expect(() => makeTrip('t1', 'Bad', n)).toThrow(RangeError)
  })
})

describe('snackSlots', () => {
  it('cycles timings morning → afternoon → evening', () => {
    expect(snackSlots(4).map((s) => s.timing)).toEqual([
      'morning',
      'afternoon',
      'evening',
      'morning',
    ])
  })
})

describe('withDayCount', () => {
  it('extends with default days, preserving existing configuration', () => {
    const trip = makeTrip('t1', 'GR20', 3)
    trip.days[2].type = 'huge'
    const extended = withDayCount(trip, 5)
    expect(extended.days).toHaveLength(5)
    expect(extended.days[2].type).toBe('huge')
    expect(extended.days[4]).toMatchObject({ index: 5, type: 'average' })
  })

  it('truncates from the end', () => {
    const trip = makeTrip('t1', 'GR20', 5)
    expect(withDayCount(trip, 2).days.map((d) => d.index)).toEqual([1, 2])
  })
})
