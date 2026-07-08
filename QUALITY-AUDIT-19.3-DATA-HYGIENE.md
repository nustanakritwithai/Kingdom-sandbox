# Phase 19.3 — Data Hygiene / Archive / Prune

> Implementation complete — schema **19.3**  
> Baseline: `QUALITY-AUDIT-19.3-DATA-HYGIENE-PREP.md` (PR #20)  
> วันที่: 2026-07-07

## Summary

Phase 19.3 เพิ่ม `BALANCE.dataHygiene`, `DataHygieneSystem`, treaty dedupe ที่ต้นเหตุ (`upsertTreaty`), archive summaries (`world.dataArchive`), และ idempotent migration cleanup โดย **ไม่แตะ gameplay balance** และ **ไม่ prune wars**

---

## Baseline (PR #20 prep audit @ day 25,000, seed 6)

| Metric | Before |
|--------|-------:|
| Full save payload | **1,587,842 B** (~1.55 MB) |
| tradeContracts | 544,929 B (35%) |
| recruitmentOffers | 238,521 B (15%) |
| treaties | 180,787 B (12%) |
| musterPoints | 118,276 B (7.6%) |
| Dead closed-record share | **~70%** of save |
| Active treaty dupes (peak) | **7–8** per pair |
| Stale pending musters @5k | **10** |
| Dead acceptedAgentIds | **24** @5k |
| Save growth | ~50 KB / 1,000 days |

---

## After implementation (@ day 25,000, seed 6)

| Metric | After | Δ |
|--------|------:|---|
| Full save payload | **741,154 B** (~724 KB) | **−53%** |
| tradeContracts | 8,885 B | −98% |
| recruitmentOffers | 841 B | −99.6% |
| treaties | 679 B | −99.6% |
| musterPoints | 2 B | ~−100% |
| Active treaty dupes (peak @3k) | **0** | fixed |
| Stale pending musters @5k | **0** | fixed |
| Dead acceptedAgentIds @5k | **0** | fixed |
| `dataArchive` summaries | ~1,580 | capped per category |

Save growth หลัง 19.3: ~30 KB / 1,000 วัน (ช่วง 10k→25k) แทน ~50 KB แบบเดิม

---

## Implemented

### Config — `BALANCE.dataHygiene`

```javascript
tickIntervalDays: 30,
archiveAfterDays: 180,
pruneAfterDays: 365,
staleMusterDays: 120,
staleRecruitmentDays: 120,
staleTradeContractDays: 365,
staleTreatyDays: 365,
maxArchivedSummaries: 500,
maxCleanupPerTick: 200,
enableMigrationCleanup: true
```

### `DataHygieneSystem`

- `tick()` — ทุก 30 วันใน `simulateDay` (หลัง `OrganizationSystem.tickDaily`)
- `cleanupTreaties` — dedupe active, archive/prune expired/broken/orphan
- `cleanupMusterPoints` — expire stale pending, archive/prune closed
- `cleanupRecruitmentOffers` — strip dead `acceptedAgentIds`, archive/prune closed
- `cleanupTradeContracts` — cancel dangling, archive/prune closed (เช็ค `agent.contractId`)
- `archiveRecord` — short summaries ใน `world.dataArchive` + era merge เมื่อเกิน cap
- `migrationCleanup` — idempotent บน load/migrate
- Metrics ใน `world.balanceMetrics.dataHygiene`

### Treaty root fix

- `getTreatyKey`, `findActiveTreaty`, `upsertTreaty`
- `setTreaty` เรียก `upsertTreaty` แทน `createTreaty` — ไม่สร้าง active duplicate

---

## Migration / idempotency

- `SaveSystem.migrate()` merge `dataHygiene` metrics + เรียก `migrationCleanup()`
- `applyPostLoad()` เรียก `migrationCleanup()` เมื่อ `enableMigrationCleanup`
- Archive ใช้ `isArchived(id)` กัน duplicate summaries
- `test-harness-193-hygiene.js` assert 2-pass migration เท่ากัน

---

## 19.1 liveness regression

```
test-harness-191-regression.js — ALL PASSED
- 1500-day sim: 0 crash / 0 NaN
- armies 4/4 seeds, battles 4/4 seeds
- caravan loss 74–81% (not 0%, not ~99%)
- save/load schema 19.3 + continue
- perf 5.1 ms/day (ceiling 25)
```

---

## Tests run

| Command | Result |
|---------|--------|
| `npm run test:core` | **PASS** (incl. `test-harness-193-hygiene.js`) |
| `test-harness-191-regression.js` | **PASS** |
| `test-harness-193-hygiene.js` | **PASS** (14 assertions) |
| `node audit/probe-save-attribution.js 6 25000` | **PASS** |
| `node audit/probe-treaty-duplicates.js 3000 42` | peak dup **0** |
| `node audit/probe-muster-growth.js 5000 7` | stale pending **0**, invalidAccepted **0** |
| `node audit/probe-data-growth.js 6 25000 1000` | save capped growth |

---

## Remaining risks

| Risk | Severity | Notes |
|------|----------|-------|
| `wars` ยังไม่ prune | 🟠 low | ตาม spec — รอ war archive แยก; growth ช้า (~19 KB @25k) |
| `settlement.history` / `factionTimeline` | 🟡 minor | ไม่มี cap ชัด — โตช้า, นอก scope 19.3 |
| Recent failed `tradeContracts` (<365d) | 🟢 OK | เก็บตาม retention — ไม่กระทบ UI active contracts |
| `maxCleanupPerTick` | 🟢 OK | 200/cat/tick เพียงพอที่ 25k; ถ้าเล่น >90k วันอาจต้อง tune |

---

## Merge recommendation

**แนะนำ merge** หลัง `npm run test:core` + `npm run test:audit` บน CI

- Save ลด ~53% @25k โดยไม่ทำให้ 19.1 liveness ถอย
- Treaty dupes = 0, stale muster = 0, dead accepted refs = 0
- Schema 19.3 migrate + idempotent cleanup ผ่าน
- ไม่มีการเปลี่ยน gameplay balance
