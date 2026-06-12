import { describe, expect, it } from 'vitest'
import { rollUpMeal } from '../../src/domain/rollups'
import type { Item, Meal } from '../../src/domain/types'

function item(partial: Partial<Item> & Pick<Item, 'id' | 'caloriesPerGram'>): Item {
  return {
    name: partial.id,
    vegetarian: true,
    inputBasis: 'per_gram',
    inputWeightG: 1,
    inputCalories: partial.caloriesPerGram,
    ...partial,
  }
}

const oatmeal = item({ id: 'oatmeal', caloriesPerGram: 3.8 })
const chia = item({ id: 'chia', caloriesPerGram: 4.9 })
const butter = item({ id: 'butter', caloriesPerGram: 7.2 })
const jerky = item({ id: 'jerky', caloriesPerGram: 3.0, vegetarian: false })

const itemsById = new Map([oatmeal, chia, butter, jerky].map((i) => [i.id, i]))

function meal(components: Meal['components']): Meal {
  return { id: 'm1', name: 'Test meal', type: 'brekkie', components }
}

describe('rollUpMeal', () => {
  it('sums weight and calories across components (story 4.3 example)', () => {
    // brekkie = 80g oatmeal + 15g chia + 20g butter
    const rollup = rollUpMeal(
      meal([
        { itemId: 'oatmeal', grams: 80 },
        { itemId: 'chia', grams: 15 },
        { itemId: 'butter', grams: 20 },
      ]),
      itemsById,
    )
    expect(rollup.weightG).toBe(115)
    expect(rollup.calories).toBeCloseTo(80 * 3.8 + 15 * 4.9 + 20 * 7.2) // 521.5
    expect(rollup.density).toBeCloseTo(521.5 / 115)
    expect(rollup.vegetarian).toBe(true)
  })

  it('is non-vegetarian if any component is non-vegetarian', () => {
    const rollup = rollUpMeal(
      meal([
        { itemId: 'oatmeal', grams: 50 },
        { itemId: 'jerky', grams: 30 },
      ]),
      itemsById,
    )
    expect(rollup.vegetarian).toBe(false)
  })

  it('supports a single item used directly as a meal', () => {
    const rollup = rollUpMeal(meal([{ itemId: 'jerky', grams: 100 }]), itemsById)
    expect(rollup).toEqual({ weightG: 100, calories: 300, density: 3, vegetarian: false })
  })

  it('counts the same item twice when listed twice (story 5.2)', () => {
    const rollup = rollUpMeal(
      meal([
        { itemId: 'butter', grams: 10 },
        { itemId: 'butter', grams: 10 },
      ]),
      itemsById,
    )
    expect(rollup.weightG).toBe(20)
    expect(rollup.calories).toBeCloseTo(144)
  })

  it('returns zeros for an empty meal without dividing by zero', () => {
    expect(rollUpMeal(meal([]), itemsById)).toEqual({
      weightG: 0,
      calories: 0,
      density: 0,
      vegetarian: true,
    })
  })

  it('throws when a component references a missing item', () => {
    expect(() => rollUpMeal(meal([{ itemId: 'ghost', grams: 10 }]), itemsById)).toThrow(/ghost/)
  })
})
