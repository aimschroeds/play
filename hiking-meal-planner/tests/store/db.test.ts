import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/store/db'
import type { Item } from '../../src/domain/types'

const oatmeal: Item = {
  id: 'item-1',
  name: 'Oatmeal',
  caloriesPerGram: 3.8,
  vegetarian: true,
  inputBasis: 'per_100g',
  inputWeightG: 100,
  inputCalories: 380,
}

describe('db', () => {
  beforeEach(async () => {
    await db.items.clear()
  })

  it('round-trips an item through IndexedDB', async () => {
    await db.items.add(oatmeal)
    const found = await db.items.get('item-1')
    expect(found).toEqual(oatmeal)
  })
})
