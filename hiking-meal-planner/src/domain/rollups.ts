// Meal roll-ups (story 4.3): weight, calories, density, and vegetarian flag
// are always derived from the meal's components — never stored — so editing
// an item automatically updates every meal that contains it (story 4.6).

import type { Item, Meal } from './types'

export interface MealRollup {
  weightG: number
  calories: number
  /** cal/g; 0 for an empty meal. */
  density: number
  /** Vegetarian only if every component item is vegetarian. */
  vegetarian: boolean
}

export function rollUpMeal(meal: Meal, itemsById: ReadonlyMap<string, Item>): MealRollup {
  const missing = meal.components
    .map((c) => c.itemId)
    .filter((id) => !itemsById.has(id))
  if (missing.length > 0) {
    throw new Error(`Meal "${meal.name}" references missing items: ${missing.join(', ')}`)
  }

  let weightG = 0
  let calories = 0
  let vegetarian = true
  for (const { itemId, grams } of meal.components) {
    const item = itemsById.get(itemId)!
    weightG += grams
    calories += grams * item.caloriesPerGram
    vegetarian &&= item.vegetarian
  }
  return {
    weightG,
    calories,
    density: weightG > 0 ? calories / weightG : 0,
    vegetarian,
  }
}
