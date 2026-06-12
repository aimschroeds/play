// Write operations with referential-integrity checks (story 4.6).
// Resolved decision: deleting an in-use item is BLOCKED, with the list of
// dependents reported so the user can untangle them first.

import { db } from './db'
import type { Item, Meal } from '../domain/types'

export class ItemInUseError extends Error {
  readonly item: Item
  readonly usedBy: Meal[]

  constructor(item: Item, usedBy: Meal[]) {
    super(
      `"${item.name}" is used by ${usedBy.length} meal${usedBy.length === 1 ? '' : 's'}: ` +
        usedBy.map((m) => m.name).join(', '),
    )
    this.name = 'ItemInUseError'
    this.item = item
    this.usedBy = usedBy
  }
}

export async function deleteItem(id: string): Promise<void> {
  await db.transaction('rw', db.items, db.meals, async () => {
    const item = await db.items.get(id)
    if (!item) return
    const usedBy = await db.meals
      .filter((m) => m.components.some((c) => c.itemId === id))
      .toArray()
    if (usedBy.length > 0) throw new ItemInUseError(item, usedBy)
    await db.items.delete(id)
  })
}

export async function deleteMeal(id: string): Promise<void> {
  // Will also need an in-use check against plan entries once plans exist (M4).
  await db.meals.delete(id)
}
