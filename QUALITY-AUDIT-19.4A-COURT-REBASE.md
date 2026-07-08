# Phase 19.4A — Court System Rebase / Activation Audit

> **Audit + minimal activation** — ไม่ใช่ court balance เต็ม  
> วันที่: 2026-07-08  
> Schema: **19.4A**

## Source branch / commit

| Item | Value |
|------|--------|
| Branch | `origin/cursor/phase19-court-politics-246b` |
| PR | #18 Phase 19: Internal Politics / Court / Succession |
| Commit | `1ab760100b0a5ac80e84a4f69887edf121ee0294` |
| Parent | `0918558` (Phase 18.5 — **ไม่ใช่** main / 19.1) |
| Original schema | `19.0` |

**ห้าม merge ตรง** — branch แยก lineage จาก main หลัง 19.1 / 19.2 / 19.3

---

## Compatibility matrix

| Area | 19.1 Liveness | 19.2 Test Infra | 19.3 Data Hygiene |
|------|:-------------:|:---------------:|:-----------------:|
| `FactionLeadershipSystem` + faction `rulerId` | ✅ Court `handleAgentDeath` ทำงานคู่ `handleRulerDeath` | — | — |
| Org `rulerId` / regency / succession | ✅ `CourtSystem.handleRulerDeath` + `chooseHeir` | — | — |
| Civil war ใช้ warband จริง | ✅ `startCivilWar` แยก warband จาก agent มีชีวิต | test #9 ยืนยัน | — |
| ไม่ spawn nobles/heirs | ✅ test-harness-19 #7–9 | — | — |
| `test-harness-19.js` + dom-mock | — | ✅ PASS (ไม่ SKIP) | — |
| `uitest-19.js` + ui-launch | — | ✅ พร้อม (SKIP เฉพาะไม่มี browser) | — |
| ไม่ prune active court | — | — | ✅ `cleanupCourtRecords` + `CourtSystem.isActiveCourtRef` |
| Archive resolved civil wars / old court logs | — | — | ✅ `world.dataArchive.court` |
| Save 19.3 → 19.4A | ✅ migrate idempotent | — | ✅ |

---

## Conflict summary (rebase onto main+19.3)

| Priority | Conflict | Resolution in 19.4A |
|----------|----------|---------------------|
| P0 | Branch parent 18.5 vs main 19.1+ | Port `CourtSystem` เป็น module ใหม่บน `a473f7b` |
| P0 | ไม่มี `WorldIntegritySystem` บน main | เพิ่ม `CourtSystem.runIntegrityCheck()` |
| P0 | `BALANCE` shape ต่างกัน | รวม `{ court, dataHygiene }` |
| P0 | Court passive tick กระทบ recruitment | `BALANCE.court.enablePoliticsTick: false` (19.4B) |
| P1 | Crown org `landed` แต่ `settlementIds` ว่าง | `runIntegrityCheck` + `updateOrganizationSovereignty` ก่อน `ensureCourt` |
| P1 | Schema 19.0 vs 19.3 | Bump → **19.4A** |
| P2 | ไม่มี `getAgentActiveWarband` | เพิ่ม helper บน main |
| P2 | UI sandbox buttons | ยังไม่ port (19.4B) — core + tests เพียงพอสำหรับ 19.4A |

---

## What was activated (minimal)

### Core
- `BALANCE.court` config (passive mode: `enablePoliticsTick: false`)
- `CourtSystem` ~750 LOC: offices, influence, factions, succession, regency, claimants, civil war (API ครบ — เรียกจาก test/sandbox ได้)
- `world.civilWars`, `world.courtClaimants`, `organization.court`
- Hooks: `SovereigntySystem.updateOrganizationSovereignty`, `NeedSystem.kill`, `SaveSystem.migrate`, `applyPostLoad`
- `CourtSystem.runIntegrityCheck()` แทน `WorldIntegritySystem.repairCourt`
- `getAgentActiveWarband()` helper

### Data hygiene (19.3 safe)
- `DataHygieneSystem.cleanupCourtRecords()` — archive resolved civil wars, cap court history
- `cleanupRecruitmentOfferRefs()` ทุกวัน — ไม่ทิ้ง dead `acceptedAgentIds`
- Do **not** prune: active offices, claimants, regency, active civil wars, succession crisis

### Passive mode (`enablePoliticsTick: false`)
- `CourtSystem.tickDaily()` เป็น no-op ใน sim ปกติ
- ป้องกัน faction AI / court decisions / auto civil war รบกวน recruitment/liveness ก่อน balance pass ใน 19.4B
- Court ยังสร้างได้ผ่าน `ensureCourt` เมื่อ org เป็น landed + test/sandbox เรียกตรง

---

## Tests run

| Command | Result |
|---------|--------|
| `npm run test:core` | **PASS** (incl. `test-harness-19.js` — ไม่ SKIP) |
| `npm run test:audit` | **PASS** |
| `node test-harness-19.js` | **PASS** (16 assertions) |
| `node test-harness-191-regression.js` | **PASS** |
| `node test-harness-193-hygiene.js` | **PASS** |
| `node audit/probe-saveload.js` | **PASS** |

### test-harness-19.js highlights
1. Landed realm มี court ✅
2. Court members / offices / heir = agent จริง ✅
3. Succession + crisis + civil war ใช้ warband จริง ✅
4. ไม่ spawn nobles ✅
5. Save/load court ✅
6. DataHygiene ไม่ prune active court ✅
7. 19.1 liveness short run with court ✅

---

## Save/load

- Schema **19.4A** — save 19.3 load ได้ + `migrateCourt` + `CourtSystem.initWorld`
- `test-harness-19.js` save/load court/succession ✅
- `test-harness-191-regression.js` roundtrip schema 19.4A ✅

---

## Data hygiene implications

| Data | Policy |
|------|--------|
| Active court offices / claimants / regency | **Never prune** |
| Active civil war | **Never prune** |
| Active succession crisis | **Never prune** |
| Resolved civil war (>180d) | Archive summary → prune (>365d) |
| Court history overflow | Archive era summary, cap `maxCourtHistory` |
| Dead `acceptedAgentIds` | Strip daily via `cleanupRecruitmentOfferRefs` |

Save @25k with court passive: ~787 KB (ยังต่ำกว่า baseline 1,588 KB)

---

## Recommendation

### ✅ Merge 19.4A (minimal activation)

เหตุผล:
- CourtSystem **active** บน main-derived branch (19.1+19.2+19.3+19.4A)
- `test-harness-19.js` **PASS** (ไม่ SKIP)
- 19.1 regression + 19.3 hygiene **PASS**
- ไม่ spawn agents / ไม่ prune court ผิด
- Passive mode ป้องกัน balance regression ก่อน 19.4B

### → Phase 19.4B (implementation / balance)

1. เปิด `BALANCE.court.enablePoliticsTick: true` ทีละขั้น
2. Tune `decisionInterval`, `civilWarPowerThreshold` หลังวัด recruitment/liveness
3. Port court UI sandbox buttons + inspector panels จาก PR #18
4. รัน long-run audit กับ passive vs active politics tick
5. พิจารณา reintroduce `WorldIntegritySystem` เฉพาะ court slice หรือขยาย `runIntegrityCheck`
6. วัดผล specialists / applicants / caravan หลังเปิด politics tick

**ไม่แนะนำ** merge PR #18 ตรง — conflict หนักกับ 19.1/19.3 lineage
