import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/store/db'
import { deleteItem, deleteMeal, ItemInUseError } from '../../src/store/repos'
import type { Item, Meal } from '../../src/domain/types'

const butter: Item = {
  id: 'butter',
  name: 'Butter',
  caloriesPerGram: 7.2,
  vegetarian: true,
  inputBasis: 'per_100g',
  inputWeightG: 100,
  inputCalories: 720,
}

const porridge: Meal = {
  id: 'porridge',
  name: 'Standard oatmeal brekkie',
  type: 'brekkie',
  components: [{ itemId: 'butter', grams: 20 }],
}

describe('deleteItem', () => {
  beforeEach(async () => {
    await Promise.all([db.items.clear(), db.meals.clear()])
    await db.items.add(butter)
  })

  it('blocks deletion of an item used by a meal and names the dependents', async () => {
    await db.meals.add(porridge)
    const err = await deleteItem('butter').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ItemInUseError)
    expect((err as ItemInUseError).usedBy.map((m) => m.name)).toEqual([
      'Standard oatmeal brekkie',
    ])
    await expect(db.items.get('butter')).resolves.toBeDefined()
  })

  it('deletes an unused item', async () => {
    await deleteItem('butter')
    await expect(db.items.get('butter')).resolves.toBeUndefined()
  })

  it('is a no-op for an unknown id', async () => {
    await expect(deleteItem('ghost')).resolves.toBeUndefined()
  })
})

describe('deleteMeal', () => {
  it('deletes the meal', async () => {
    await db.meals.add(porridge)
    await deleteMeal('porridge')
    await expect(db.meals.get('porridge')).resolves.toBeUndefined()
  })
})
