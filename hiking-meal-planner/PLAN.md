# Hiking Trip Meal Planner — Build Plan

A plan for implementing the web app described in the user stories (Epics 1–8).

---

## 1. Stack recommendation

**Recommended: TypeScript end-to-end, local-first, no backend.**

- **Frontend:** React 18 + Vite + TypeScript
- **State:** Zustand (simple, no boilerplate) for UI state; domain data lives in the persistence layer
- **Persistence:** IndexedDB via **Dexie.js** (typed tables, queries, migrations)
- **CSV:** Papa Parse (import) + hand-rolled serializer (export)
- **Styling:** Tailwind CSS
- **Testing:** Vitest for the domain core; Playwright for a few end-to-end smoke flows
- **Deployment:** static hosting (GitHub Pages / Netlify / Vercel) — zero ops, free

### Why no backend?

Every feature in the stories is single-user and computational:

- No auth, no sharing between accounts, no server-side jobs.
- "Sharing with trip partners" (4.10) is explicitly handled via **CSV export/import**, not accounts.
- All calculations (densities, carries, totals, plan generation) are fast enough to run in the browser instantly — and *should* run there so totals update live as you edit.
- A static SPA means nothing to deploy, secure, or pay for.

### Alternative considered: Python backend (FastAPI + SQLite) + React frontend

Choose this instead only if any of these become requirements:

- Access the same data from multiple devices (phone in town at the resupply, laptop at home) without manual export/import.
- Real multi-user collaboration on one trip.

The architecture below keeps this door open: the **domain core is a pure TypeScript package with zero browser dependencies**, so it could later run in a Node API, or its logic could be ported behind a FastAPI service while the React app stays intact. A cheaper middle ground for multi-device is adding an optional sync layer (e.g., export-to-file or a tiny sync endpoint) later.

---

## 2. Architecture

Three strictly separated layers inside one Vite project (npm workspaces are overkill at this size; use folders with lint-enforced import boundaries):

```
hiking-meal-planner/
├── src/
│   ├── domain/        # PURE: types, calculations, carry derivation, generator, CSV codecs
│   │   ├── types.ts
│   │   ├── density.ts        # normalization to cal/g (4.1, 4.2)
│   │   ├── rollups.ts        # meal weight/cal/density/veg roll-ups (4.3)
│   │   ├── carries.ts        # resupply → carry derivation (3.2)
│   │   ├── totals.ts         # day / carry / trip summaries (Epic 7)
│   │   ├── generate.ts       # plan generation (Epic 8)
│   │   └── csv/              # item & meal import/export codecs (4.8–4.10)
│   ├── store/         # Dexie schema, repositories, referential-integrity checks (4.6)
│   ├── ui/            # React components, routes, forms
│   └── app.tsx
├── tests/             # Vitest unit tests mirror src/domain/
└── e2e/               # Playwright smoke flows
```

**Rule:** `domain/` imports nothing from `store/` or `ui/`. All acceptance criteria in the stories are testable as pure functions — that's where the correctness risk lives (carry boundaries, density normalization, generation), so that's where the tests concentrate.

---

## 3. Data model

```
Trip        { id, name, days: Day[], people: PersonId[], dayTypeFactors: {small, average, big, huge} }
Person      { id, name, baselineCalories, vegetarian }
Day         { index, type: small|average|big|huge, activeSlots: SlotId[] }   // partial days = subset of slots (2.3)
Resupply    { dayIndex, timing: before_breakfast | after_lunch | late_afternoon | after_dinner }
Item        { id, name, caloriesPerGram, vegetarian, inputBasis }            // raw entry kept for display; density is canonical (4.1)
Meal        { id, name, type: brekkie|snack|lunch|dinner, components: [{itemId, grams}] }
PlanEntry   { tripId, personId, dayIndex, slot, mealId | offTrail, quantityScale, locked, offTrailCalories? }
```

Notes:

- **Slots:** a day has `brekkie`, `lunch`, `dinner`, and an ordered list of snack slots (snacks get a `timing` of morning/afternoon/evening to support carry-splitting — see open item resolution below).
- **Carries are derived, never stored** (3.2). `carries.ts` is a pure function `(trip, resupplies) → Carry[]` where each carry is a list of `(dayIndex, slot)` pairs. This makes the 10-day acceptance example in story 3.2 a literal unit test fixture.
- **Meal roll-ups are derived, never stored** (4.3, 4.9): weight = Σ grams, calories = Σ grams × density, vegetarian = AND of components. Editing an item automatically updates every meal because nothing is denormalized.
- **Per-person plans** (5.3): `PlanEntry` is keyed by person — no shared-meal modeling needed.
- **Off-trail** (Epic 6): a `PlanEntry` variant with zero weight and optional calories; days with calorie-less off-trail entries render as "partially estimated", not under-target.

### Persistence

Dexie tables: `trips`, `people`, `items`, `meals`, `planEntries`, `settings`. Dexie's versioned migrations handle schema evolution. Add a one-click **full JSON backup/restore** early — local-first means the browser profile is the database, and users should be able to get everything out.

---

## 4. Key algorithms

### Carry derivation (3.2)

Walk slots in chronological order `(day, slot-with-timing)`; a resupply's `timing` defines the cut point. Slots strictly before the cut belong to the previous carry; the cut slot onward starts the new carry. The story's acceptance example becomes the canonical test.

### Plan generation (8.1–8.3)

Greedy heuristic — do **not** reach for an ILP solver first; the problem is small (one day ≈ 4–8 slots) and a heuristic with quantity-scaling gets within ±5% easily:

1. Filter library to meals matching slot type + vegetarian constraint; skip off-trail and inactive (partial-day) slots; keep locked picks (8.2).
2. Fill brekkie/lunch/dinner choosing meals near `target × typical-share` (configurable shares, e.g. 25/30/35%), preferring higher density when the carry has a density target.
3. Fill snack slots greedily to close the remaining gap.
4. Fine-tune: scale component quantities within per-item min/max bounds (see §6) to land within tolerance — e.g. butter in oatmeal as the densest lever.
5. Seed with randomness so "regenerate" (8.3) gives a different plan each tap.

Pure function: `(day, person, library, carryContext, lockedEntries, rng) → PlanEntry[]`. Trivially unit-testable with synthetic libraries.

### CSV codecs (4.8–4.10)

Import is two-phase: **parse + validate → preview report → commit**. The validation report (row number, reason, duplicate resolution choices) is a data structure produced by the domain layer; the UI just renders it. Export reuses the same column definitions so round-tripping is lossless by construction.

---

## 5. Milestones

Each milestone ships something usable; order front-loads the riskiest pure logic.

| # | Scope | Stories |
|---|-------|---------|
| **M0** | Project scaffold: Vite + React + TS + Tailwind + Dexie + Vitest, CI (lint, typecheck, test), deploy pipeline | — |
| **M1** | **Food library**: items CRUD with density normalization, meals composer with roll-ups, filter/sort, edit/delete with in-use warnings | 4.1–4.7 |
| **M2** | **Trip setup**: trips, people, day types + scaling factors, partial days | 1.1–1.3, 2.1–2.3 |
| **M3** | **Resupplies & carries**: resupply editor, derived carries with boundary visualization | 3.1–3.3 |
| **M4** | **Manual planning + totals**: per-person day grid, slot assignment, off-trail slots, day/carry/trip summaries with target flagging | 5.1–5.3, 6.1–6.2, 7.1–7.4 |
| **M5** | **CSV import/export** with validation preview and duplicate handling | 4.8–4.10 |
| **M6** | **Plan generation**: generate day/carry, locking, regenerate, quantity scaling | 8.1–8.3 |

Rationale for the order: M1 first because everything depends on the library and density math; M4 before generation because the manual planner *is* the UI generation writes into — generation (M6) then becomes "compute entries, insert them", reusing everything. CSV (M5) lands before M6 so you can seed a realistic library to exercise the generator against.

---

## 6. Proposed resolutions for the open items

1. **Snack timing on resupply days** — give each snack slot a coarse `timing` (morning / afternoon / evening). The carry-derivation function compares snack timing to resupply timing: morning snacks before an after-lunch resupply → old carry; afternoon/evening → new carry. No extra user input on normal days; timing has sensible defaults.
2. **Deleting in-use items/meals** — **block with a "used by" list** (e.g. "used by 3 meals, 2 trips" with links). Cascading deletes silently corrupt past trip plans; blocking is predictable and the dialog tells the user exactly what to untangle. Offer "archive" later if blocking feels annoying.
3. **Quantity-scaling bounds for generation** — per-item optional `minGrams`/`maxGrams` with a global default of **0.5×–1.5× of the quantity in the source meal**. Per-item overrides handle the 200g-butter problem (butter: max ~30g) without requiring bounds on every item.

---

## 7. Testing strategy

- **Domain core (Vitest, the bulk of tests):** every acceptance criterion in the stories maps to a unit test — the 3.2 carry example verbatim, density normalization across all four input bases, meal roll-ups, vegetarian AND-logic, partial-day slot filtering, off-trail zero-weight, generation tolerance/constraints, CSV round-trip property test (export → import → identical library).
- **Store layer:** integrity checks (delete-blocking, duplicate name handling) against a real in-memory IndexedDB (fake-indexeddb).
- **E2E (Playwright, thin):** one happy path — create trip → add people → import items CSV → build a day → generate a carry → check totals.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| IndexedDB data lost with browser profile | JSON backup/restore from M1; CSV export for library |
| Generator produces weird plans | It's a starting point by design (8.3); locking + manual edit always available; bounds (§6.3) cap absurdity |
| Later need for multi-device sync | Pure domain core + repository pattern keeps a future API/sync layer additive, not a rewrite |
| Scope creep in UI polish | Milestones each end in something usable; ship M4 to real trip-planning before investing in M6 |
