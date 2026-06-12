import type { Slot } from '../domain/types'

export const fmtDensity = (calPerGram: number) => `${calPerGram.toFixed(2)} cal/g`
export const fmtGrams = (g: number) => `${Math.round(g)} g`
export const fmtCalories = (cal: number) => `${Math.round(cal)} cal`

export const fmtSlot = (slot: Slot) =>
  slot.type === 'snack' ? `snack (${slot.timing})` : slot.type
