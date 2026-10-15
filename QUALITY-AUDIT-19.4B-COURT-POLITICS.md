# Quality Audit — Phase 19.4B Court Politics Activation

**Date:** 2026-07-08  
**Branch:** `cursor/phase194b-court-politics-activation-246b`  
**Schema:** `19.4B`  
**Baseline:** Phase 19.4A passive court (`enablePoliticsTick: false`)

---

## Summary

Phase 19.4B replaces the boolean `enablePoliticsTick` with staged `politicsMode` and adds throttles, liveness guards, court metrics, minimal UI, and data-hygiene compatibility. Default mode is **`shadow`** (not `active`).

| Mode | Behavior |
|------|----------|
| `passive` | Court ensure/repair; basic regency/succession on death; no auto faction/decision/civil-war tick |
| `shadow` | Plans decisions + faction pressure; logs `[shadow]` decisions; **no gameplay apply** |
| `limited` | Applies **low-risk** decisions only; no auto civil war/coup; no recruitment drain; no mass office reshuffle |
| `active` | Full politics with cooldowns/budgets; civil war via real warbands only; recruitment offer gated |

---

## Baseline vs 19.4B

| Metric | 19.4A passive | 19.4B shadow (default) |
|--------|---------------|------------------------|
| `enablePoliticsTick` | `false` | migrated → `politicsMode` |
| Auto court decisions | off | computed, not applied |
| Faction AI civil war | off | off (active only) |
| `recruitmentOffers` drain | N/A | guarded |
| Schema | `19.4A` | `19.4B` |

---

## Shadow / Limited / Active Comparison (probe-court-politics.js)

Probe runs: passive/shadow/limited × 3000d (or 500d in CI), active × 1000d optional.

| Mode | Decisions applied | Liveness (caravans) | Civil wars |
|------|-------------------|---------------------|------------|
| passive | 0 | stable | 0 auto |
| shadow | 0 | stable | 0 |
| limited | low (heir/tax/peace) | stable | 0 auto |
| active | higher | monitored | throttled; real warbands only |

---

## Recruitment Impact

- `CourtSystem.canApplyDecision()` blocks high `estimateLivenessImpact()` decisions
- Protected offer types: `defend_settlement`, `anti_bandit_patrol`, `caravan_guard_job`, `militia_call`
- `startCivilWar()` only posts `royal_conscription` when under offer cap + linked `militaryNeed` (no blind spawn)
- **test-harness-194b:** open offers not drained; 19.1 liveness caravans ≥ 3 @ 400d

---

## Civil War Safety

- Auto coup/civil war only in **`active`** mode with cooldowns
- `startCivilWar(..., { force: true })` for tests/sandbox only
- Rebel warband via `WarbandSystem.createFromMembers` — **no new agents**
- Requires ≥2 real rebel agents + successful warband creation

---

## Data Hygiene Compatibility

- `cleanupCourtRecords` skips: active offices, court members, claimants, regency, civil war, succession crisis
- Archives: resolved civil wars, old decisions (short summaries), court history overflow
- Metrics: `courtDataPruned`, `courtArchiveCount`
- **test-harness-194b #9:** active court refs preserved after migrationCleanup + tick

---

## UI Status

Ported minimal court UI from PR #18 (no dangerous sandbox bulk):

- **Organization detail:** `สำนัก` section — ruler/regent/heir, politics mode, stability, council, factions, claimants, recent decisions
- **Character detail:** `Politics` section — influence, office, heir, faction, claimant
- **World summary:** `Court Politics` block — mode, realms, crises, factions, civil wars, decision metrics
- **Sandbox tools:** `nameHeir`, `triggerSuccessionCrisis`, `openUnstableCourt` (instant, no map click)

`uitest-19.js` expects these strings — should PASS in browser environment.

---

## Tests Run

```bash
npm run test:core          # includes test-harness-194b-court-politics.js
npm run test:audit
node test-harness-19.js
node test-harness-194b-court-politics.js
node test-harness-191-regression.js
node test-harness-193-hygiene.js
node audit/probe-court-politics.js 500 1
node audit/probe-saveload.js
```

**test-harness-194b:** 12/12 PASS  
**Migration:** 19.4A → 19.4B idempotent (`passive` preserved)

---

## Recommended Default Mode

**`shadow`** — observes court pressure and decision planning without affecting liveness. Promote to `limited` after long-run audit; `active` remains experimental until multi-seed probe passes consistently.

---

## Remaining Risks

1. **`active` mode** — civil war/coup still high-impact; needs extended probe (3000d × 4 seeds) before production default
2. **Office effects in limited** — steward/treasurer ticks run in limited/active; monitor settlement prosperity side effects
3. **Court member set** — all `org.memberIds` now included in court (broader than 19.4A fame/leadership filter); improves heir/succession coverage
4. **UI** — read-only court panels; no in-UI politics mode switch (config via `BALANCE.court.politicsMode` / save `world.courtPoliticsMode`)

---

## Files Changed

- `script.js` — CourtSystem staged politics, metrics, guards, UI, schema 19.4B
- `test-harness-194b-court-politics.js` — new
- `audit/probe-court-politics.js` — new
- `scripts/run-all-tests.js` — register new tests
- `test-harness-19.js` — civil war `force: true` for direct API test
