import { describe, expect, it } from 'vitest'
import { calorieDensity, scaledDailyTarget } from '../../src/domain/density'
import { DEFAULT_DAY_TYPE_FACTORS } from '../../src/domain/types'

describe('calorieDensity', () => {
  it('normalizes per-gram entry (butter: 9 cal per 1g)', () => {
    expect(calorieDensity({ weightG: 1, calories: 9 })).toBe(9)
  })

  it('normalizes per-100g entry (oatmeal: 380 cal per 100g)', () => {
    expect(calorieDensity({ weightG: 100, calories: 380 })).toBeCloseTo(3.8)
  })

  it('normalizes per-serving entry (40g serving, 150 cal)', () => {
    expect(calorieDensity({ weightG: 40, calories: 150 })).toBeCloseTo(3.75)
  })

  it('normalizes per-package entry (Snickers: 50g bar, 250 cal)', () => {
    expect(calorieDensity({ weightG: 50, calories: 250 })).toBe(5)
  })

  it('allows zero-calorie items', () => {
    expect(calorieDensity({ weightG: 500, calories: 0 })).toBe(0)
  })

  it.each([0, -10, NaN, Infinity])('rejects weightG = %s', (weightG) => {
    expect(() => calorieDensity({ weightG, calories: 100 })).toThrow(RangeError)
  })

  it.each([-1, NaN, Infinity])('rejects calories = %s', (calories) => {
    expect(() => calorieDensity({ weightG: 100, calories })).toThrow(RangeError)
  })
})

describe('scaledDailyTarget', () => {
  it('scales baseline by the day-type factor (story 2.2)', () => {
    expect(scaledDailyTarget(2500, DEFAULT_DAY_TYPE_FACTORS.small)).toBe(1875)
    expect(scaledDailyTarget(2500, DEFAULT_DAY_TYPE_FACTORS.average)).toBe(2500)
    expect(scaledDailyTarget(2500, DEFAULT_DAY_TYPE_FACTORS.big)).toBe(3125)
    expect(scaledDailyTarget(2500, DEFAULT_DAY_TYPE_FACTORS.huge)).toBe(3750)
  })
})
