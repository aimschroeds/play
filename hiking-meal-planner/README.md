# Hiking Trip Meal Planner

A local-first web app for planning food on multi-day hiking trips: people with
calorie targets, day-effort scaling, resupplies and carries, a food/meal
library with calorie-density math, and auto-generated meal plans.

See [PLAN.md](./PLAN.md) for the full build plan, data model, and milestones.

## Stack

React + Vite + TypeScript, Tailwind CSS, Dexie (IndexedDB), Zustand, Vitest.
No backend — all data lives in the browser; sharing is via CSV export/import.

## Development

```bash
npm install
npm run dev        # dev server
npm test           # unit tests (Vitest)
npm run typecheck  # tsc
npm run lint       # eslint
npm run build      # production build
```

## Layout

```
src/domain/   pure logic: types, density, carries, totals, generation, CSV
src/store/    Dexie schema and repositories
src/ui/       React components
tests/        Vitest unit tests (mirrors src/)
```

`src/domain/` must not import from `store/` or `ui/`.
