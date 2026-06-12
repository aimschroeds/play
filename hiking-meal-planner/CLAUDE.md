# Hiking Trip Meal Planner

Local-first React SPA for planning food on multi-day hikes. See PLAN.md for
the full design, data model, and milestone history (M0–M6, all shipped).

## Commands

All run from `hiking-meal-planner/`:

```bash
npm run dev        # dev server
npm test           # Vitest unit tests
npm run typecheck  # tsc (covers src/ and tests/)
npm run lint       # eslint
npm run build      # production build
```

## Architecture rules

- `src/domain/` is pure: no imports from `src/store/` or `src/ui/`, no
  browser APIs. All derived values (densities, meal roll-ups, carries,
  totals, generated plans) are computed here, never stored.
- `src/store/` owns Dexie (IndexedDB). Schema changes bump `db.version()`
  in `db.ts`. Writes with integrity rules (delete-blocking, cascades) go
  through `repos.ts`, not raw table access.
- Every acceptance criterion from the user stories maps to a unit test in
  `tests/` (mirrors `src/`). The story 3.2 carry example is the canonical
  carries fixture.

## Workflow

- **Commit intermittently**: small, focused commits as work progresses
  (e.g. domain logic, store layer, UI, tests separately) — not one big
  commit per feature.
- Branch per change → PR to `main` → merge when the path-filtered CI
  (`.github/workflows/hiking-meal-planner.yml`) is green.
- Run the npm commands above from the subdirectory; running `npx` from the
  repo root litters a stray `node_modules/`.
