# Phase 19.3 Prep — Data Hygiene Audit

> **Audit เท่านั้น — ไม่มีการแก้ gameplay logic** (ยืนยัน `git diff script.js index.html` = ว่าง)
> เพิ่มเฉพาะ probe scripts ใน `audit/` + รายงานฉบับนี้ ทุก finding รันซ้ำได้
> วันที่: 2026-07-07

## Scope
เตรียม Phase 19.3 (Data Hygiene) โดย audit ปัญหาข้อมูลสะสมระยะยาวที่รายงาน v18.5 ชี้ไว้ (treaty ซ้ำ, muster สะสม, save โต) แล้ววัดจริงด้วยการจำลอง **3,000 → 50,000 วัน** เพื่อดูว่า array ไหน "โตไม่หยุด" และ save payload โตจากอะไร งานนี้ **ไม่แก้โค้ดเกม ไม่ปรับ balance ไม่แตะ test infra** (Composer ทำ Phase 19.2 แยก) — ส่งเป็น audit + plan + prototype probe ก่อนลงมือแก้จริง

## Branch / Commit
- Branch: `claude/phase193-data-hygiene-audit`
- ฐาน: `cursor/phase191-liveness-unlock-246b` (canonical 19.1, PR #19 ยัง open/draft ยังไม่ merge เข้า main; main ยัง schema 18.5)
- schema ที่ audit: **19.1**

## วิธีรันซ้ำ
```bash
node audit/probe-data-growth.js <seed> <days> [interval]   # snapshot array/save ทุก interval → audit/data-growth/seed-N.jsonl
node audit/probe-treaty-duplicates.js [days] [seed]         # treaty dup/stale/orphan
node audit/probe-muster-growth.js [days] [seed]             # muster/offer/need status + staleness
node audit/probe-save-attribution.js [seed] [maxDays]       # bytes ต่อ section ที่ day 500/3000/10000/25000
```
รันจริงในออดิตนี้: data-growth 3k×seeds{1,2,3}, 10k×{4,5}, 25k×{6}, 50k×{7}; treaty 3k; muster 5k; save-attribution 25k

---

## 1. Data Growth Results

**save payload โตเชิงเส้น ~50KB ต่อ 1,000 วัน** (agents คงที่ตามประชากร แต่ closed-record arrays โตไม่หยุด):

| day | save size | treaties | recruitOffers | musterPoints | tradeContracts | chronicle | events |
|----:|----------:|---------:|--------------:|-------------:|---------------:|----------:|-------:|
| 500 | 490 KB | 24 | 6 | 5 | 36 | 67 | 600 |
| 3,000 | 681 KB | 113 | 132 | 135 | 273 | 353 | 600 |
| 10,000 | 1,038 KB | ~330 | ~330 | ~330 | ~1,100 | 500 | 600 |
| 25,000 | 1,550 KB | 917 | 566 | 571 | 2,215 | 500 | 600 |
| 50,000 | 2,732 KB | 1,999 | 1,091 | 1,125 | 3,952 | 500 | 600 |

**สรุปแนวโน้ม (ต่อ array):**

| Array | โต? | กลไก |
|---|---|---|
| **tradeContracts** | 🔴 unbounded (มากสุด) | filter :7111 ลบเฉพาะ dangling-ref — completed/failed สะสมถาวร |
| **treaties** | 🔴 unbounded | ไม่มี prune เลย (status พลิกเป็น expired/broken แล้วค้าง) |
| **recruitmentOffers** | 🔴 unbounded | cleanupOrphans :3261 ลบเฉพาะ expired/cancelled — failed/filled/labor ค้าง |
| **musterPoints** | 🔴 unbounded | ไม่มี prune เลย |
| **wars** | 🟠 slow | ไม่มี prune (แต่ต่อ record เล็ก: 1→35 ใน 50k วัน) |
| **organizations** | 🟠 slow | count โตช้า (5→10); org.history capped (ORG_HISTORY_CAP) ✓ |
| **agents** | 🟢 pop-bound | dead GC ใน 3 วัน (:9679) — bytes ตามประชากร ไม่โต |
| **chronicle** | 🟢 capped 500 | splice :760 ✓ (ถึง cap ~day 10k) |
| **events** | 🟢 capped 600 | splice :734 ✓ |
| **scoutReports** | 🟢 capped | MAX_SCOUT_REPORTS (shift) ✓ |
| **battleReports** | 🟢 ~คงที่ | โตช้ามาก |
| **militaryNeeds** | 🟢 pruned | filter :9761 เก็บ active หรืออายุ < 90 วัน (เพิ่มใน 19.1) ✓ |

**Entity history (จาก seed-6 @25k):** org.history max 24 (capped ✓), agentCareer max 6 (cap 12 ✓), agentMemory avg 469B/max 1.1KB (stable ✓), balanceMetrics 514B (คงที่ ✓) — **แต่** settlement.history max 40 และ factionTimeline max 40 ไม่มี cap ชัดเจน (โตช้า, minor)

---

## 2. Treaty Findings
`node audit/probe-treaty-duplicates.js 3000 42`

- **total 121 ที่ day 3000 / 917 ที่ day 25000** — ไม่เคยถูกลบ (25k: expired 756, broken 158, **active เพียง 3**)
- **duplicate active treaty คู่เดิม+type เดียวกัน: สูงสุด 7–8 ฉบับพร้อมกัน** (คู่ `1-191:trade`) — ทับช่วง active กัน (startDays 135,170,175,180,205,215,230,245 / endDays ต่างกันเล็กน้อย)
- **orphan (party faction หาย): 0** — parties ยังชี้ faction จริง (faction ไม่ถูกลบทั้งก้อน)
- **treaties missing history array: 0**
- **peak dup ระหว่างรัน: 8** (day 250)

**สาเหตุ (code path):**
- `setTreaty()` :10095 — เรียก `createTreaty` ทุก type โดย **ไม่เช็ค active duplicate** ก่อน
- `createTreaty()` :10078 — `world.treaties.push` เสมอ (ไม่มี dedupe)
- `updateTreaties()` :10242 / `breakTreaty()` :10141 — พลิก status เป็น expired/broken เท่านั้น **ไม่ลบออกจาก array**
- `DiplomacySystem` proposal :~10537 — path trade เช็ค `some(active)` ก่อนเสนอ **แต่** path อื่น (peace-stalemate ที่ `simulateDay` และ setTreaty โดยตรง) ไม่เช็ค → เกิด dup
- grep ยืนยัน: **ไม่มีที่ใด filter `world.treaties` เพื่อ prune**

**Suggested prune rule (details §6)**: กัน active dup ต่อ (parties+type) + archive expired/broken เกิน N วันเป็น chronicle summary

---

## 3. Muster & Recruitment Findings
`node audit/probe-muster-growth.js 5000 7`

**musterPoints @5000:** total **199** — `failed` 176, `complete` 12, `pending` 11
- **noAgents 164** (muster ที่ไม่เคยมีใครมา), **stale pending > 60 วัน: 10** (pending ค้างไม่ยอมจบ), **oldest stale: 3928 วันหลัง targetDay** (muster จาก ~day 1000 ยังอยู่ที่ day 5000)
- orphan(no org/settlement): 0 (ref ยังดี)
- 🔴 **ไม่มี prune เลย** — สะสม ~35 failed ต่อ 1,000 วัน

**recruitmentOffers @5000:** total **191** — `failed` 176, `filled` 12, `open` 3
- **closed แต่ 0 accepted: 163**, **invalidAccepted (agent ตายแล้วยังอยู่ใน list): 24**, invalidTarget 0
- repeated-fail กระจุกที่ org เดิม: `208:royal_conscription` fail 45, `209:royal_conscription` 35, `2755:anti_bandit_patrol` 21 — ควร aggregate เป็น failure stats แทนเก็บทุกใบ
- 🔴 `cleanupOrphans()` :3261 ลบเฉพาะ expired/cancelled — **failed/filled สะสมถาวร**

**militaryNeeds @5000:** total **0** — ✅ prune :9761 (active หรือ <90 วัน) ทำงานดี ไม่มี stuck/orphan

**Bug surface (นอกเหนือ hygiene):** pending muster 10–11 ใบ "ค้างตลอดกาล" — `tickTravelingMembers` fail muster เฉพาะตอน `status==='pending' && targetDay ผ่าน` แต่ถ้า offer ถูก mark failed/expired จาก escalation ก่อน mp อาจค้าง pending ไม่มีใคร resolve → ควรให้ 19.3 บังคับ expire pending ที่เกิน targetDay+N

---

## 4. Save Attribution
`node audit/probe-save-attribution.js 6 25000` — bytes ต่อ section (% ของ payload):

| Section | d500 | d3000 | d10000 | d25000 | trend |
|---|---:|---:|---:|---:|---|
| agents | 345 KB (69%) | 305 KB | 324 KB | 218 KB | 🟢 pop-bound |
| **tradeContracts** | 8.5 KB | 66 KB | 220 KB | **545 KB (35%)** | 🔴 leak #1 |
| **recruitmentOffers** | 2.5 KB | 55 KB | 121 KB | **238 KB (15%)** | 🔴 leak #2 |
| **treaties** | 4.5 KB | 22 KB | 68 KB | **181 KB (12%)** | 🔴 leak #3 |
| **musterPoints** | 1 KB | 28 KB | 61 KB | **118 KB (7.6%)** | 🔴 leak #4 |
| chronicle | 15 KB | 76 KB | 113 KB | 114 KB | 🟢 capped 500 |
| events | 71 KB | 70 KB | 70 KB | 70 KB | 🟢 capped 600 |
| wars | ~0 | 2.8 KB | 8 KB | 19 KB | 🟠 slow |
| organizations | 4 KB | 11 KB | 14 KB | 16 KB | 🟠 slow |
| settlements | 27 KB | 29 KB | 30 KB | 31 KB | 🟢 ~คงที่ |
| **full payload** | **490 KB** | **681 KB** | **1,038 KB** | **1,550 KB** | — |

**agent sub-fields @25k:** memory 28 KB, relationships 1.2 KB, career 3.7 KB, deeds 0.6 KB (agents คงที่, ไม่ใช่ปัญหา)

👉 **ที่ day 25,000: 4 leaks (tradeContracts+offers+treaties+musters) = ~1,082 KB = 70% ของ save เป็น closed/dead records**

---

## 5. Long-run Risk

| ระยะ | save size | อาการ |
|---|---|---|
| 3,000 วัน | 0.68 MB | ปกติ |
| 10,000 วัน | 1.04 MB | เริ่มมี dead records เป็นสัดส่วนใหญ่ |
| 25,000 วัน | 1.55 MB | 70% เป็นขยะ; serialize/parse เริ่มช้า |
| 50,000 วัน | 2.73 MB | ใกล้ครึ่ง quota; DiplomacySystem/tickRecruitment วน filter array ยาวทุกวัน |
| ~90,000 วัน | ~5 MB | **ชน localStorage quota → save ล้มเหลวเงียบ** |

นอกจากขนาด save: หลาย system วน `world.treaties/recruitmentOffers/musterPoints` **ทั้ง array ทุกวัน** (เช่น `tickRecruitment`, `tickTravelingMembers`, `updateTreaties`, diplomacy filters) → เมื่อ array ยาวขึ้น per-day cost โตตาม แม้ audit longrun เดิมยังไม่เห็น perf ตกชัด (~2–10ms/วันที่ pop ต่ำ) แต่จะแย่ลงที่ 25k–50k วัน

**engine ยังนิ่ง:** ตลอด 50,000 วัน ไม่มี crash / NaN / dangling (เป็นเรื่อง "ขยะสะสม" ล้วน ไม่ใช่ correctness)

---

## 6. Safe Cleanup Rules (ข้อเสนอ — ยังไม่แก้)

ค่าคงที่แนะนำ (ตั้งใน BALANCE/CONFIG): `ARCHIVE_AFTER_DAYS = 60`, `STALE_MUSTER_DAYS = 30`

### Treaties
- **กัน active duplicate**: ก่อน `createTreaty` ใน `setTreaty()` → ถ้ามี active ฉบับเดิม (parties+type เดียวกัน) ให้ **ต่ออายุ/อัปเดต endDay ฉบับเดิม** แทนสร้างใหม่ (เก็บฉบับ endDay ไกลสุด/terms แข็งสุด)
- **prune**: expired/broken ที่เกิน `ARCHIVE_AFTER_DAYS` → ลบออกจาก `world.treaties`, สรุปเป็น 1 chronicle entry ("สนธิสัญญา X–Y สิ้นสุด") ไม่เก็บ object เต็ม
- เก็บ active + ที่เพิ่งจบไว้เพื่อ UI diplomacy timeline

### MusterPoints
- completed/failed ที่เกิน `ARCHIVE_AFTER_DAYS` → prune
- orphaned (org/settlement หาย) → prune ทันทีหลัง integrity log
- **pending ที่เลย targetDay + `STALE_MUSTER_DAYS`** → บังคับ `status='failed'` แล้วปล่อย recruit ค้าง (แก้ bug pending ค้างตลอดกาล) ก่อน prune

### RecruitmentOffers
- filled/failed/expired ที่เกิน `ARCHIVE_AFTER_DAYS` → prune (ขยาย `cleanupOrphans` filter ให้รวม failed/filled + อายุ)
- offers ที่ acceptedAgentIds มี agent ตาย → cleanup id ที่ตายออก
- repeated-fail org+type เดิม → รวมเป็น `org.failureStats` (นับครั้ง) แทนเก็บทุกใบ

### MilitaryNeeds — ✅ มี prune 90 วันแล้ว (19.1) คงไว้

### TradeContracts (leak ใหญ่สุด — ต้องแก้)
- completed/failed/expired ที่เกิน `ARCHIVE_AFTER_DAYS` → prune (ปัจจุบัน filter :7111 ลบเฉพาะ dangling-ref)
- สรุปยอด completed/failed เป็น `world.marketIndex` counter หรือ guild stats แทนเก็บ object

### Chronicle / Events — ✅ capped แล้ว (500/600) คงไว้; ตรวจว่า cap ยังทำงานหลัง prune อื่น

### ScoutReports / BattleReports — scoutReports capped แล้ว; battleReports โตช้า แต่ควร cap "keep famous + recent N" เผื่ออนาคต

### Agent Memory / History — stable แล้ว; settlement.history + factionTimeline ควรใส่ cap (keep recent N + era summary) เป็น low-priority

---

## 7. Cleanup Risk (reference safety)

| ข้อมูล | ความเสี่ยง | คำแนะนำ |
|---|---|---|
| treaties (expired/broken) | UI diplomacy timeline / chronicle อาจอ้างถึง | **Prune with archive** — สรุปเป็น chronicle summary ก่อนลบ |
| treaties (active dup) | ไม่มี ref ภายนอกชี้ treaty.id (เป็น value obj) | **Safe to prune/merge** |
| musterPoints (failed/complete) | offer.musterPointId ชี้ mp | prune คู่กัน (offer+mp) หรือ null offer.musterPointId ก่อน |
| recruitmentOffers (failed/filled) | agent.memberships/pendingLaborOffer อาจอ้าง org ไม่ใช่ offer.id โดยตรง | **Safe** ถ้าปล่อย stranded recruit ก่อน (มี releaseStrandedRecruits ใน 19.1 แล้ว) |
| tradeContracts (closed) | agent.contractId ชี้ contract | null `a.contractId` ถ้า contract ถูก prune (มี loop :7120 อยู่แล้ว — ต่อยอดได้) |
| wars (ended) | chronicle/battleReports ชี้ war; ObserverSystem war history | **Do not prune yet** — UI แสดงประวัติสงคราม; ถ้าจะ prune ต้อง archive |
| battleReports | chronicle link / civil-war metadata | **Prune with archive** เท่านั้น |
| save/load migration | payload เก่า (pre-19.3) มี record ค้างเยอะ | `migrate()` ควรรัน prune pass ครั้งเดียวตอนโหลด (idempotent) |
| WorldIntegrity | branch นี้ **ไม่มี** WorldIntegritySystem (อยู่ใน PR #17 ที่ยังไม่ merge) | prune ทำใน tick ปกติ; ถ้า #17 merged ให้ integrity repair หลัง prune |

**ป้าย:**
- **Safe to prune**: active-dup treaties, orphaned musters, invalid accepted-agent ids
- **Prune with archive**: expired/broken treaties, closed tradeContracts, battleReports
- **Do not prune yet**: wars (ended) — ต้อง design war-archive ก่อน
- **Needs migration**: save เก่าต้อง prune pass ตอน load

---

## 8. Phase 19.3 Implementation Plan (ลำดับแก้จริง — รอบถัดไป)

1. **เพิ่ม CONFIG**: `ARCHIVE_AFTER_DAYS`, `STALE_MUSTER_DAYS`, cap constants
2. **Treaty dedupe** ใน `setTreaty()` — กัน active dup (แก้จุดต้นเหตุก่อน ลดการสร้างขยะ)
3. **`DataHygieneSystem.tick()`** ใหม่ (เรียกใน `simulateDay` ทุก ~30 วัน batched): prune treaties/musterPoints/recruitmentOffers/tradeContracts ที่ closed+เกินอายุ พร้อม archive summary
4. **แก้ pending muster ค้าง** — บังคับ expire ที่เกิน targetDay+STALE
5. **ขยาย `cleanupOrphans`** ให้รวม failed/filled offers + invalid accepted ids
6. **migrate() prune pass** — save เก่าโดน prune ครั้งเดียวตอนโหลด (schema → 19.2 หรือ 19.3)
7. **wars/battleReports archive** (ถ้าจะทำ) — design แยก, low priority
8. เก็บ prune stats ลง `world.balanceMetrics` (prunedTreaties, prunedMusters, …) เพื่อ observability

**ต้นเหตุก่อน ปลายเหตุตาม**: ทำข้อ 2 (กัน dup) + ข้อ 4 (pending) ก่อน แล้วค่อย prune (ข้อ 3) เพราะกันไม่ให้สร้างขยะใหม่สำคัญกว่าตามเก็บ

## 9. Tests Needed for 19.3
- `test-harness-193-hygiene.js`:
  1. active treaty ต่อ (parties+type) ไม่เกิน 1 หลังจำลองยาว
  2. expired/broken treaty ถูก prune หลัง ARCHIVE_AFTER_DAYS (แต่ยังมี chronicle summary)
  3. failed/complete musterPoints + failed/filled offers ถูก prune
  4. pending muster เกิน stale → expire ไม่ค้าง
  5. tradeContracts closed ถูก prune; agent.contractId ไม่ dangling
  6. **save size ที่ 25,000 วัน < X KB** (regression guard เทียบ baseline ในรายงานนี้)
  7. save/load เก่า (pre-19.3 payload ที่มี record ค้าง) โหลดได้ + prune pass ทำงาน + 0 NaN
  8. dangling-ref check หลัง prune (offer.musterPointId, agent.contractId, chronicle→war)
- รัน `audit/probe-data-growth.js` / `probe-save-attribution.js` ซ้ำ → ยืนยัน save size โตช้าลงมาก (เส้นแบน)

## 10. Recommendation
- **ควรทำ Phase 19.3** — leak ชัดเจนและวัดได้ (70% ของ save ที่ 25k วันเป็นขยะ) แม้ engine ยังนิ่ง มันคือหนี้ที่โตเชิงเส้นและจะชน quota ที่ ~90k วัน + ทำ per-day filter ช้าลง
- **ควร merge audit report นี้** (audit-only, ไม่แตะ gameplay/test infra — ไม่ชนกับ Composer 19.2)
- **ระวังก่อนแก้จริง**:
  1. archive ก่อน prune เสมอ (treaty/battleReport ผูกกับ chronicle/UI)
  2. กัน active-dup ที่ต้นเหตุก่อน (ข้อ 2) ก่อนจะไล่ prune
  3. migrate() ต้อง idempotent + จัดการ save เก่าที่มี record ค้างมหาศาล
  4. อย่าแตะ chronicle/events/scoutReports/militaryNeeds cap ที่ทำงานดีอยู่แล้ว
  5. wars ยัง **do-not-prune** จนกว่าจะ design war-archive (UI แสดงประวัติสงคราม)

---
*ไฟล์เกม (`script.js`, `index.html`) และ test เดิม **ไม่ถูกแตะ** — เพิ่มเฉพาะ `audit/probe-data-growth.js`, `audit/probe-treaty-duplicates.js`, `audit/probe-muster-growth.js`, `audit/probe-save-attribution.js`, `audit/data-growth/*.jsonl` และรายงานฉบับนี้*
