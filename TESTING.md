# Testing — Living Kingdom Sandbox

## Quick start

```bash
npm install          # optional: playwright-core / puppeteer for UI tests
npm run test:core    # required regression gate (~3–8 min)
npm run test:audit   # long-run probes (~2–5 min)
npm run test:ui      # browser smoke (SKIP if no browser)
npm run test:all     # core + audit + ui
```

Without npm:

```bash
node scripts/run-all-tests.js --core
node scripts/run-all-tests.js --audit
node scripts/run-all-tests.js --all
```

## Required pre-merge gate

Before merging gameplay PRs (Phase 19.3+), these **must pass**:

```bash
npm run test:core
npm run test:audit
```

Core includes:

| File | Purpose |
|------|---------|
| `test-harness-184.js` | Detail pages / UI indexes |
| `test-harness-184b.js` | Guild sovereignty |
| `test-harness-185.js` | World stability / invariants |
| `test-harness-185-save.js` | Save/load soak |
| `test-harness-19.js` | Court politics |
| `test-harness-191-liveness.js` | Phase 19.1 liveness unlock |
| `test-harness-191-regression.js` | **Regression gate** (caravan/army/ruler/schema) |
| `test-harness-193-hygiene.js` | Phase 19.3 data hygiene / archive / prune |

UI tests are **recommended** when Chromium is available:

```bash
npm run test:ui
```

If `playwright-core` or a browser executable is missing, UI tests exit with `SKIP` (not a failure).

## Shared test utilities

All new headless tests should use:

```js
const {
  createTestSandbox, seedRandom, run, runDays, findNaN,
  getCurrentSchemaVersion, saveLoadRoundtrip, createTestReporter
} = require('./test-utils/dom-mock');
```

- **`test-utils/dom-mock.js`** — DOM mock, vm sandbox, NaN/dangling checks, save/load roundtrip
- **`test-utils/ui-launch.js`** — playwright-core / puppeteer launcher with graceful SKIP

Do **not** copy inline `mockEl()` blocks into new harness files.

### Schema assertions

Never hardcode schema versions (e.g. `'18.2'`, `'19.1'`). Use:

```js
const schema = getCurrentSchemaVersion(sandbox);
// assert payload.schemaVersion === schema
```

Migration tests should assert old saves **migrate to** `getCurrentSchemaVersion()`, not that output equals an old version.

### Flaky search tests

When testing `ObserverSystem.search` or similar:

- Use **full entity names** or **entity ids** from the same seeded world
- Assert `results.some(r => r.id === targetId)` — not rank #1
- Lock RNG with `seedRandom(sandbox, seed)` when needed

## Optional / slow tests

| Group | Runtime | Notes |
|-------|---------|-------|
| `audit/probe-longrun.js 8 3000` | ~1–2 min | 8 seeds × 3000 days |
| `test-harness-185.js` soak | ~30–90 s | includes 5000-day optional soak |
| `test-harness-191-liveness.js` | ~2 min | multi-seed 3000d checks |
| UI smoke (`uitest-*.js`, `audit/uismoke.js`) | ~10–30 s each | needs browser |

## Obsolete / legacy harness (kept for history)

These files predate `test-utils/dom-mock.js` and are **not** in the required gate. They may fail on current schema without maintenance:

| File | Status | Reason |
|------|--------|--------|
| `test-harness-11.js` … `13.js` | Legacy | Phase 11–13; hardcoded old schema |
| `test-harness-105.js`, `106.js` | Legacy | Early stability probes |
| `test-harness-181.js`, `182.js` | Superseded | Covered by 184 + combat paths |
| `test-harness-12.js`, `17.js`, `18.js` | Legacy | Hardcoded `18.2` schema |
| `uitest-11.js` … `uitest-184.js` | Optional | Phase-specific UI; use `uitest-19.js` / `uitest-185.js` |

`test-harness-15.js` — observer panel; search + schema fixed in 19.2 but still optional.

## Liveness metrics (post Phase 19.1)

`test-harness-191-regression.js` guards:

- Armies/musters on some seeds (not 0/8)
- Caravan loss **not ~99%** and **not 0% on all seeds**
- Dangling ruler/governor refs = 0
- Route danger recovery
- Schema + save/load continue
- No spawned soldiers, no clone agents

Expected baseline (8×3000d audit):

- Armies: 6/8 seeds
- Battles: every seed
- Caravan robbery: 74–81% (liveness metric)
- Route danger: ~0.02 after patrol
- Crash / NaN: 0

## Reading runner output

```
File                                 Group   Result  Time      Notes
test-harness-191-regression.js       core    PASS    45.2s
uitest-19.js                         ui      SKIP    0.3s      SKIP UI: browser not available
```

Exit code `1` only when a **required** test fails. Optional UI skips are OK.
