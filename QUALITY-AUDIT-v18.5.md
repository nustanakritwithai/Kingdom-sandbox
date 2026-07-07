# รายงานออดิตคุณภาพและเสถียรภาพ — Living Kingdom Sandbox v18.5 (Phase 19)

> ออดิตอย่างเดียว ไม่มีการแก้โค้ดเกม — ทุก finding มีสคริปต์ยืนยันซ้ำได้ใน `audit/`
> ขอบเขต: จำลองรวม **24,000+ วัน (8 seeds × 3000 วัน)** + ตรวจ test suite 24 ไฟล์ + UI smoke ผ่าน Chromium จริง
> วันที่ออดิต: 2026-07-07

---

## 1. คำตัดสินโดยสรุป

**เอนจินเสถียรมาก แต่เนื้อเกมครึ่งหลัง (Phase 12–18) ไม่เคยทำงานเองตามธรรมชาติ**
ตลอด 24,000 วันจำลอง ไม่มี crash แม้แต่ครั้งเดียว ไม่มี NaN แม้แต่ค่าเดียว ประชากรไม่สูญพันธุ์ ราคาไม่หลุด clamp ประสิทธิภาพคงที่ ~10ms/วัน (รองรับ x20 สบาย) save/load แม่นยำ 100% และ UI ไม่มี error เลย — **ในแง่ "โปรแกรม" ถือว่าผ่านเกณฑ์ production**
แต่ในแง่ "โลกจำลอง" โลกทุก seed จมลงสู่ **ยุคมืดถาวรแบบเดียวกัน**: เกณฑ์ทหารล้มเหลว 100% → สงครามทุกครั้งจบด้วย 0 การรบ → โจรครองเส้นทาง ปล้นคาราวาน 95%+ → 92% ของการตายทั้งหมดคืออดตายกลางทาง → เมืองหลวงร้างเหลือ 1 คนตั้งแต่วันที่ ~500 → ระบบสงคราม/กิลด์/สัญญาการค้าของ Phase 12–18 ไม่เคยถูกใช้งานจริงนอก test ที่บังคับ scenario

---

## 2. Findings เรียงตามความรุนแรง

### 🔴 F1 — Critical: สงครามไม่เคยมีการรบ (ระบบทัพทั้งหมดตายทางปฏิบัติ)

**อาการ**: ทั้ง 8 seeds × 3000 วัน มีการตั้งกองทัพ (`createArmy`) **0 ครั้ง** สงครามที่ประกาศทุกครั้ง (3–6 ครั้ง/seed) จบด้วย 0 battle, 0 casualties ด้วยกติกา stalemate ที่ ~91 วัน (`simulateDay` script.js:9741)

**สาเหตุ (trace จากสงครามจริง seed 1, day 1035–1126)**:
1. `GovernanceSystem.raiseArmy` (script.js:8912) ต้องมี warband ชนิด `royal_army` สมาชิก ≥6 — ไม่มี → เรียก `raiseCallToArms` (script.js:3481) โพสต์ offer `royal_conscription` ที่**เมืองหลวงเท่านั้น**
2. `tickRecruitment` (script.js:3336) สแกนผู้สมัครจาก `agentsAt(offer.settlementId)` — **เฉพาะคนที่อยู่ในเมืองเดียวกับ offer** ไม่มีการเรียกคนจากเมืองอื่น
3. เมืองหลวง (ปราสาทสุวรรณ) ร้างตั้งแต่ day ~500 (ดู F2) — ตอนสงคราม มีผู้สมัครที่เข้าเกณฑ์ **1 คน คือตัวราชาเอง** (คะแนน −85.4)
4. เกณฑ์คะแนน `evaluateJoinOffer ≥ 12` (script.js:3344) สูงเกินสำหรับพลเรือนทั่วไป: riskLevel 0.55 หักราว −11, ค่าตอบแทน (pay 15, food 8) ให้แค่ +8.4 — เฉพาะคนใกล้อดตายเท่านั้นที่ผ่าน
5. ผล: ราชาประกาศระดมพล **13 ครั้ง**, offer 6 ใบ, ผู้สมัคร **0 คน**, muster fail ทุกใบ → ไม่มี warband → ไม่มีกองทัพ → สงครามหมดเวลา

**ผลพวง**: `CampaignWarfareSystem` (supply lines, scouting), `LargeBattlefieldSystem`, `TextCombatCore` ระดับกองทัพ — ไม่เคยถูกเรียกในเกมจริง (supplyLines=0, scoutReports=0, largeBattles=0 ทุก seed)

**ยืนยันซ้ำ**: `node audit/probe-war.js`

---

### 🔴 F2 — Critical: สมดุลโลกพัง — "วงจรยุคมืด" ถาวรทุก seed

**อาการ** (seed 1, 3000 วัน — seed อื่นเหมือนกันหมด):
- คาราวานเมือง: ส่ง 729 → **สูญหาย 727 (99.7%)** | ถูกปล้นรวม 697 ครั้ง
- การตายรวม 2,189 ครั้ง — **92% คือ "อดอาหารตายระหว่างเดินทาง"** (trader 736, migrant 697, bandit 583)
- เมืองหลวง (ปราสาท) เหลือประชากร **1 คน** ตั้งแต่ day ~500 | ป้อมตะวันตก 0 คน | หมู่บ้านไม้/เหมือง 1 คน → **miner/crafter สูญพันธุ์, woodcutter เหลือ 0–1**
- ประชากรรวมอยู่รอด (85–150) เพราะ spawn ทดแทน ไม่ใช่เพราะโลกสมดุล

**วงจรป้อนกลับ (positive feedback loop)**:
```
กองทัพ/patrol เกิดไม่ได้ (F1)          ← เมืองหลวงร้าง
   ↓
เส้นทางไร้การคุ้มกัน (guard unit เกิด 2 หน่วยใน 3000 วัน)
   ↓
โจรปล้นคาราวาน (chance ต่อวัน = danger×0.22) และปล้นสำเร็จ +0.08 danger
   → danger สะสม → ยิ่งปล้นง่ายขึ้นเรื่อยๆ (script.js:7718)
   ↓
คนขนของหมดตัว (เสียเงิน 40–80% + สินค้าทั้งหมด) → ซื้อเสบียงไม่ได้ → อดตายกลางทาง
   ↓
เมืองผลิตอาหารน้อย (ปราสาท/ป้อม) นำเข้าไม่ได้ → ราคาพุ่ง → คนอพยพออก → เมืองร้าง
   ↓ (วนกลับขึ้นบน)
```
- `LogisticsSystem.updateSettlement` (script.js:5011) ส่งคาราวานใหม่ไม่หยุด — สร้าง agent ใหม่เป็นคนขนได้เรื่อยๆ (script.js:5040) กลายเป็น "สายพานส่งคนไปตาย" และเป็นแหล่งรายได้หลักของโจร
- อาชีพจึงเหลือแค่ farmer (ในเมืองอาหาร) + trader + bandit — `AgentAI.decide` (script.js:5576) ให้คะแนนงาน wood/ore ตาม `prodPotential` ของเมืองที่อยู่ ซึ่งไร้ความหมายเมื่อหมู่บ้านผลิตร้างไปแล้ว

**ยืนยันซ้ำ**: `node audit/probe-professions.js 3000 1`

---

### 🟠 F3 — High: อาณาจักรไร้ราชาถาวร (succession ล้มเหลวแบบไม่ฟื้น)

**อาการ**: หลัง 3000 วัน อาณาจักรหลัก (8 เมือง) `rulerId` ชี้ไปยัง agent ที่ถูกลบจาก array ไปแล้ว และ**ไม่มี king/lord มีชีวิตอยู่ใน faction เลย** — พบใน **ทุก seed** (8/8) รวมถึง faction โจรด้วย

**สาเหตุ**: `handleRulerDeath` (script.js:8985) ถ้าไม่มีทายาทที่เข้าเกณฑ์ (`RULER_PROFS` หรือ leadership > 4) จะเข้าสู่ "ยุคไร้ผู้นำ" โดย:
- **ไม่ล้าง/ไม่ตั้ง `f.rulerId` ใหม่** — ค้างชี้ศพ ซึ่งถูก GC ทิ้งใน 3 วัน (script.js:9679) → dangling reference
- **ไม่มีกลไก retry** — ไม่มีโค้ดใดตรวจภายหลังว่า faction ไร้ผู้นำแล้วเลือกใหม่
- `updateFactions` (script.js:8884) เจอ ruler ตาย → `continue` ข้าม faction นั้น = **อัมพาตถาวร**: ไม่แต่งตั้ง governor, ไม่ยกทัพ, ไม่ส่งเงินช่วยเมืองอดอยาก (ผูกกับ F1/F2)
- governorId ก็ dangling ในลักษณะเดียวกัน (ป้อมตะวันตกไร้ governor ตลอดกาลเพราะการแต่งตั้งต้องผ่านราชาที่ตายแล้ว)

**ยืนยันซ้ำ**: `node audit/probe-longrun.js 8 3000` (ดู integrityIssues) — เกณฑ์ leadership>4 นั้นในทางปฏิบัติแทบไม่มีใครถึง เพราะประชากรหมุนเวียนตายเร็ว (F2) สกิลไม่ทันโต

---

### 🟡 F4 — Medium: ข้อมูลสะสมไม่ถูก prune (treaty, musterPoint)

- `world.treaties` ไม่เคยลบ record ที่ expired/broken: สะสม 113–138 รายการ/3000 วัน และ**ลงนาม trade treaty ซ้ำคู่เดิมขณะที่ฉบับเก่ายัง active ได้** สูงสุดพบ **7 ฉบับพร้อมกัน** — เพราะ path เสนอสัญญาที่ script.js:9411 **ไม่เช็คสัญญาเดิม** (ต่างจาก path ที่ script.js:9426 ที่เช็ค)
- `world.musterPoints` สะสม muster ที่ fail แล้วตลอดกาล (22 รายการ/3000 วัน ไม่มีโค้ดลบเลย)
- ผลกระทบ: save โต (~60KB/1000 วัน), UI/diplomacy วน filter ทั้ง array ทุกวัน — ยังไม่วิกฤตที่หมื่นวัน แต่เป็นหนี้สะสม

**ยืนยันซ้ำ**: `node audit/probe-treaties.js 3000`

### 🟡 F5 — Medium: ระบบ Phase 12/18 ไม่เคยเกิดเองตามธรรมชาติ

ตลอด 24,000 วัน (ไม่ใช้ sandbox tools):

| ระบบ | Phase | เกิดจริง | หมายเหตุ |
|---|---|---|---|
| Guild / Merchant Guild | 12 | **0 กิลด์** | เงื่อนไขก่อตั้งไม่เคยถึง |
| Warehouse | 12 | 0 | ตามกิลด์ |
| Trade Contract สำเร็จ | 12 | 0 (fail 8) | คาราวานสัญญาถูกปล้นหมด (F2) |
| Army / Campaign | 18 | 0 | F1 |
| Supply Line / Scout | 18 | 0 | F1 |
| Large Battle / Text Combat ระดับทัพ | 18.1–18.2 | 0 | F1 |
| Warband (Phase 18.3 entity) | 18.3 | 0 คงอยู่ | muster ไม่เคยสำเร็จ |
| Sovereignty / vassal grant / claim | 18.4B | 0 | ไม่มีการยึดเมือง |

ระบบที่ **มีชีวิตดี**: เศรษฐกิจราคา/ผลิต, migration, การทูต (treaty 100+, สงครามประกาศจริง), โจรปล้น (697), emergency relief (fallback 53), era summary, chronicle, succession จนถึงจุดที่ล้ม (F3), mayor/gov ระดับเมือง

### 🟡 F6 — Medium: Test suite ผุ 11/13 ไฟล์ (ไม่ใช่ regression ของเกม)

| ไฟล์ | ผล | สาเหตุ | ประเภท |
|---|---|---|---|
| test-harness-105 / 106 | 💥 crash | mock ไม่มี `overlay.classList.contains` (SaveSystem.refreshContinueUI :14235) | DOM mock เก่า |
| test-harness-11 / 13 | 💥 crash | mock ไม่มี `el.querySelector` (ObserverSystem.showToast :10241) | DOM mock เก่า |
| test-harness-12 | 22 OK / 1 FAIL | hardcode `schema === '18.2'` (จริง 18.5) | assertion ล้าสมัย |
| test-harness-15 | 18 OK / 1 FAIL + flaky | schema + `search settlement failed` ~1/9 รอบ (ชื่อสุ่มชนใน ranking ของ ObserverSystem.search) | ล้าสมัย + flaky |
| test-harness-17 / 18 / 181 / 182 | OK ทั้งหมดยกเว้น 1 | hardcode schema 18.2 | assertion ล้าสมัย |
| test-harness-183 | 14 OK / 1 FAIL | hardcode schema 18.3 | assertion ล้าสมัย |
| test-harness-184 / 184b | ✅ ผ่านหมด | — | — |
| uitest-* (11 ไฟล์) | ▪ รันไม่ได้ | ต้องใช้ puppeteer (ไม่ได้ประกาศ dependency ที่ไหน — repo ไม่มี package.json) | env |

ข้อสรุปสำคัญ: **ไม่มี harness ตัวใด fail เพราะพฤติกรรมเกมถดถอย** — เป็นการผุของ test infra ล้วนๆ แต่ก็แปลว่า CI ในสภาพนี้จับ regression จริงไม่ได้เลย (fail ทุกครั้งอยู่แล้ว) และ harness ทุกตัว copy DOM mock ของตัวเอง (~50 บรรทัด × 13 ไฟล์) จึงผุพร้อมกันเมื่อโค้ด UI แตะ API ใหม่

### 🟢 F7 — Low: save payload โตช้าแต่ไม่หยุด

521KB (day 500) → 703KB (day 3000) ≈ +60KB/1000 วัน จาก treaties + chronicle + musterPoints (F4) — quota localStorage ~5MB จะถึงเพดานราว ~70,000 วัน ไม่เร่งด่วน

---

## 3. สิ่งที่แข็งแรงดี (ยืนยันด้วยตัวเลข)

| ด้าน | ผล |
|---|---|
| Crash | **0** ใน 24,000+ วัน (8 seeds) |
| NaN / Infinity ใน world ทั้งก้อน | **0** |
| ราคาติด clamp (0.3×–6× base) | **0/80 รายการ** ณ day 3000 |
| ประชากรปลายทาง | 85–150 ทุก seed (ไม่สูญพันธุ์ ไม่ explode) |
| เวลาประมวลผล/วัน | ~9–13ms คงที่ day 250 → 3000 (ไม่ degrade; งบ x20 = 45ms/วัน เหลือเฟือ) |
| Save→Load roundtrip | ตรงเป๊ะ (day/pop/treasury) + sim ต่อ 100 วันไม่ crash |
| Migrate save schema 18.2 → 18.5 | ผ่าน + sim ต่อ 50 วันปกติ |
| UI smoke (Chromium จริง): โหลด, sim x20, ทุก panel, heatmap 9 โหมด, คลิก inspector | **0 console error / 0 pageerror** |
| Array มี cap ถูกต้อง | events (600), chronicle, career ต่อ agent, dead-agent GC ทำงาน |

## 4. วิธีรันซ้ำ (reproduce)

```bash
node audit/probe-longrun.js 8 3000   # เสถียรภาพ+liveness 8 seeds (~4 นาที)
node audit/probe-war.js              # trace สงคราม→ระดมพลล้มเหลว (F1)
node audit/probe-professions.js      # อาชีพล่ม เมืองร้าง สาเหตุการตาย (F2)
node audit/probe-treaties.js         # treaty สะสม+ซ้ำ (F4)
node audit/probe-saveload.js         # roundtrip + migration + ขนาด (F7)
npm i playwright-core && node audit/uismoke.js   # UI smoke (ใช้ Chromium ของเครื่อง)
for f in test-harness-*.js; do node $f; done      # สถานะ test suite (F6)
```

## 5. Roadmap ข้อเสนอ (ยังไม่ได้ทำ — รอตัดสินใจ)

**Phase 19.1 — ปลดล็อกเนื้อเกม (แก้ F1/F2/F3 ที่ต้นเหตุ, ~5 จุดแก้เฉพาะทาง)**
1. Recruitment ข้ามเมือง: ให้ offer ประกาศถึงเมืองอื่นใน faction (หรือ governor เกณฑ์คนส่งไปเมืองหลวง) + ลดเกณฑ์คะแนน/เพิ่มค่าจ้างตาม warDemand
2. Interregnum retry: ทุก N วัน faction ไร้ผู้นำเลือกผู้นำใหม่จากคนที่ดีที่สุดที่มี (ไม่ต้องผ่านเกณฑ์ขั้นต่ำ) และล้าง rulerId/governorId ที่ dangling
3. ตัดวงจรปล้น: คาราวานมีการ์ดจ้างจริง / patrol อัตโนมัติจาก garrison เมื่อ route.danger สูง / ลด feedback +0.08 → มี decay ชนะได้
4. คนเดินทางถือเสบียงตามระยะทางจริง (คำนวณจาก path ไม่ใช่ค่าตายตัว 4)
5. เมืองผลิตเฉพาะทาง (เหมือง/ป่า) มีแรงดึงกลับ เช่น ค่าแรงพรีเมียมเมื่อขาดแคลน — กัน depopulation ถาวร

**Phase 19.2 — ซ่อม test infra (แก้ F6, งานกลไกล้วน)**
1. แยก DOM mock + bootstrap เป็นไฟล์กลาง (มีแบบแล้วใน `audit/lib.js`) ให้ harness ทุกตัว require
2. เปลี่ยน schema assertion เป็นอ่านค่าคงที่ปัจจุบัน (`SAVE_SCHEMA_VERSION`) แทน hardcode
3. แก้ flaky search ใน harness-15 (ค้นด้วยชื่อเต็ม หรือ assert แบบไม่พึ่ง ranking)
4. ย้าย uitest จาก puppeteer → playwright-core + สร้าง `run-all-tests.sh`
5. เพิ่ม `test-harness-19-stability.js` จาก probe ชุดนี้ (multi-seed, NaN, integrity, liveness ขั้นต่ำ เช่น "สงครามต้องมี battle ≥1")

**Phase 19.3 — สุขอนามัยข้อมูล (แก้ F4/F7)**: เช็คสัญญาซ้ำก่อนลงนาม (script.js:9411), prune treaties/musterPoints ที่จบแล้วเกิน N วัน, เก็บเฉพาะสรุปลง chronicle

---

*ไฟล์เกม (`script.js`, `index.html`, `style.css`) และ test เดิมทั้งหมด **ไม่ถูกแตะต้อง** ในออดิตนี้ — เพิ่มเฉพาะ `audit/` และรายงานฉบับนี้*
