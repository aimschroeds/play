// Core entities. See PLAN.md §3 for the data model rationale.
// Everything derivable (meal roll-ups, carries, totals) is computed by
// functions in this package, never stored.

export type DayType = 'small' | 'average' | 'big' | 'huge'

export type MealType = 'brekkie' | 'snack' | 'lunch' | 'dinner'

/** Coarse position of a slot within the day; drives carry-splitting of
 *  snacks around mid-day resupplies (PLAN.md §6.1). */
export type SlotTiming = 'morning' | 'midday' | 'afternoon' | 'evening'

export type ResupplyTiming =
  | 'before_breakfast'
  | 'after_lunch'
  | 'late_afternoon'
  | 'after_dinner'

/** Basis the user typed weight/calories in. Display metadata only —
 *  caloriesPerGram is the canonical value (story 4.1). */
export type InputBasis = 'per_gram' | 'per_100g' | 'per_serving' | 'per_package'

export interface Person {
  id: string
  name: string
  /** Baseline daily calorie target, scaled per day by DayType factor. */
  baselineCalories: number
  vegetarian: boolean
}

export interface Slot {
  type: MealType
  timing: SlotTiming
}

export interface Day {
  /** 1-based day number within the trip. */
  index: number
  type: DayType
  /** Slots that apply on this day; partial first/last days list a subset
   *  (story 2.3). */
  activeSlots: Slot[]
}

export interface Trip {
  id: string
  name: string
  days: Day[]
  peopleIds: string[]
  dayTypeFactors: Record<DayType, number>
}

export interface Resupply {
  id: string
  tripId: string
  dayIndex: number
  timing: ResupplyTiming
}

export interface Item {
  id: string
  name: string
  /** Canonical calorie density (story 4.1). */
  caloriesPerGram: number
  vegetarian: boolean
  inputBasis: InputBasis
  /** Raw entry as typed, kept for display/editing. */
  inputWeightG: number
  inputCalories: number
}

export interface MealComponent {
  itemId: string
  grams: number
}

export interface Meal {
  id: string
  name: string
  type: MealType
  components: MealComponent[]
}

/** Defaults per story 2.2; user-tunable per trip. */
export const DEFAULT_DAY_TYPE_FACTORS: Record<DayType, number> = {
  small: 0.75,
  average: 1.0,
  big: 1.25,
  huge: 1.5,
}
