# Phase 19.2 — Test Infrastructure Repair

## Executive summary

Phase 19.2 consolidates fragmented headless/UI test infrastructure onto shared utilities and a unified runner. **No gameplay logic or balance was changed.** Recommendation: **merge**.

---

## Before: what was broken

| Issue | Symptom | Root cause |
|-------|---------|------------|
| Duplicated DOM mocks | Harness drift; missing `querySelector` / `classList.contains` | Each `test-harness-*.js` copied its own `mockEl()` |
| Hardcoded schema | `18.2` / `18.3` / `19.1` asserts failed after bumps | Tests asserted literal version strings |
| Missing harness files | `test-harness-19.js`, `185.js` absent on 19.1 branch | Claude consolidation dropped cursor-only files |
| `WorldIntegritySystem` / `CourtSystem` tests | Crash on 19.1 canonical branch | Tests written for unreleased Phase 19 / 18.5B APIs |
| Flaky search (`test-harness-15.js`) | Random name prefix missed entities | Partial name + ranking sensitivity |
| No unified runner | Manual ad-hoc `node test-harness-*.js` | No `package.json` scripts |
| UI deps undeclared | `uitest-*.js` required puppeteer with no package entry | No graceful SKIP |
| `audit/uismoke.js` | Hard crash if `playwright-core` missing | Top-level `require` |

---

## After: what passes

### Core (`npm run test:core`) — ~5 min

| Test | Result |
|------|--------|
| `test-harness-184.js` | PASS |
| `test-harness-184b.js` | PASS |
| `test-harness-185.js` | PASS (adapted for 19.1 APIs) |
| `test-harness-185-save.js` | PASS |
| `test-harness-19.js` | **SKIP** — `CourtSystem` not merged yet |
| `test-harness-191-liveness.js` | PASS |
| `test-harness-191-regression.js` | PASS (new gate) |

### Audit (`npm run test:audit`) — ~2 min

All probes PASS: longrun 8×3000, war, professions, saveload, treaties.

### UI (`npm run test:ui`)

| Test | Result |
|------|--------|
| `uitest-185.js` | PASS (puppeteer) |
| `uitest-19.js` | SKIP — CourtSystem pending |
| `audit/uismoke.js` | PASS or SKIP (browser/deps) |

---

## New infrastructure

| Artifact | Purpose |
|----------|---------|
| `test-utils/dom-mock.js` | Shared sandbox, DOM mock, NaN/dangling checks, `getCurrentSchemaVersion()`, `saveLoadRoundtrip()` |
| `test-utils/ui-launch.js` | playwright-core / puppeteer launcher + SKIP |
| `scripts/run-all-tests.js` | `--core`, `--audit`, `--ui`, `--all` with table output |
| `test-harness-191-regression.js` | Required liveness regression gate |
| `TESTING.md` | How to run, required gate, obsolete harness list |
| `package.json` | `test`, `test:core`, `test:audit`, `test:ui`, `test:all` |

---

## Obsolete / optional harness

Kept in repo, documented in `TESTING.md`, **not** in required gate:

- `test-harness-11.js` … `18.js` — hardcoded `18.2` schema
- `test-harness-181.js`, `182.js` — superseded by 184+
- `uitest-11.js` … `uitest-184.js` — phase-specific; use `uitest-19.js` / `uitest-185.js`

---

## Required pre-merge gate (new)

```bash
npm run test:core
npm run test:audit
```

Includes `test-harness-191-regression.js` guarding:

- 0 crash / 0 NaN
- No clone agents / no spawned soldiers
- No dangling ruler refs / null city owners
- Army/muster/battle on some seeds
- Caravan loss not ~99% and not 0% on all seeds
- Route danger recovery
- Save/load schema + continue sim
- Perf ceiling ~25 ms/day

---

## Gameplay logic touched?

**No.** Only test files, `audit/lib.js` (re-export shared mock), and `audit/uismoke.js` (SKIP handling).

---

## Recommendation

**Merge** — repo now has a single shared mock, dynamic schema assertions, unified runner, and a documented regression gate aligned with Phase 19.1 liveness metrics.
