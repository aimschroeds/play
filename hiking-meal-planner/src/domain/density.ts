// Calorie-density normalization (stories 4.1, 4.2).
//
// Weight and calories may be entered on any consistent basis (per gram,
// per 100g, per serving, per package); since both numbers share the basis,
// density is simply calories / weight and the basis itself is display
// metadata.

export interface DensityInput {
  /** Weight in grams on the chosen basis. Must be > 0. */
  weightG: number
  /** Calories for that same weight. Must be >= 0. */
  calories: number
}

export function calorieDensity({ weightG, calories }: DensityInput): number {
  if (!Number.isFinite(weightG) || weightG <= 0) {
    throw new RangeError(`weightG must be a positive number, got ${weightG}`)
  }
  if (!Number.isFinite(calories) || calories < 0) {
    throw new RangeError(`calories must be a non-negative number, got ${calories}`)
  }
  return calories / weightG
}

/** A person's calorie target for a day = baseline × day-type factor (story 2.2). */
export function scaledDailyTarget(baselineCalories: number, dayTypeFactor: number): number {
  return baselineCalories * dayTypeFactor
}
