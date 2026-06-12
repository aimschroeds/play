import Dexie, { type EntityTable } from 'dexie'
import type { Item, Meal, Person, Trip } from '../domain/types'

// Dexie versioned schema — bump version() and add an upgrade() when the
// shape changes. Only indexed fields are listed in stores().
export const db = new Dexie('hiking-meal-planner') as Dexie & {
  trips: EntityTable<Trip, 'id'>
  people: EntityTable<Person, 'id'>
  items: EntityTable<Item, 'id'>
  meals: EntityTable<Meal, 'id'>
}

db.version(1).stores({
  trips: 'id, name',
  people: 'id, name',
  items: 'id, name',
  meals: 'id, name, type',
})
