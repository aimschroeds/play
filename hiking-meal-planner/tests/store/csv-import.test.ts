import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/store/db'
import { commitItemImport, commitMealImport } from '../../src/store/repos'
import { parseItemsCsv, planItemImport } from '../../src/domain/csv/items'
import { parseMealsCsv, planMealImport } from '../../src/domain/csv/meals'

describe('CSV import commits', () => {
  beforeEach(async () => {
    await Promise.all([db.items.clear(), db.meals.clear()])
  })

  it('imports items with normalized density', async () => {
    const { rows } = parseItemsCsv(
      'name,weight_g,calories,vegetarian\nOatmeal,100,380,true',
    )
    await commitItemImport(planItemImport(rows, [], 'skip'))
    const items = await db.items.toArray()
    expect(items).toHaveLength(1)
    expect(items[0].caloriesPerGram).toBeCloseTo(3.8)
  })

  it('imports meals, auto-creating stubs and resolving items by name', async () => {
    const { rows } = parseItemsCsv('name,weight_g,calories,vegetarian\nButter,100,720,true')
    await commitItemImport(planItemImport(rows, [], 'skip'))

    const { groups } = parseMealsCsv(
      'meal_name,meal_type,item_name,quantity_g\nToast,brekkie,Butter,20\nToast,brekkie,Bread,60',
    )
    const items = await db.items.toArray()
    await commitMealImport(
      planMealImport(groups, items, [], { duplicates: 'skip', missingItems: 'stub' }),
    )

    const meals = await db.meals.toArray()
    expect(meals).toHaveLength(1)
    expect(meals[0].components).toHaveLength(2)

    const bread = (await db.items.toArray()).find((i) => i.name === 'Bread')
    expect(bread).toBeDefined()
    expect(bread?.caloriesPerGram).toBe(0)
    expect(bread?.vegetarian).toBe(false)
    expect(meals[0].components.map((c) => c.itemId)).toContain(bread?.id)
  })
})
