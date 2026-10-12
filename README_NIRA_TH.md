# The Realm of Nira — R1 Autonomous NPC Atlas

**Canonical source:** `nustanakritwithai/Kingdom-sandbox` → `nira.html` / `world/nira/`  
**Public viewer mirror:** `nustanakritwithai/AstraLife` → `/nira/`

## ทำงานแล้วใน R1

- ภาพ Canon Pixel Art 1536×1536 พร้อม 13 เขต 55 สถานที่ 68 เส้นทาง
- NPC 30 ตัวจริงตาม `spawn_setup.json` (Niravale 15, Greenford 5, Solkar 5, Silverpeak 5)
- Rule/Utility AI: ประเมินความหิว พัก ทำงาน เก็บทรัพยากร สร้างสินค้า ตลาด และพ่อค้าเดินทางไปขาย
- เดินทางทีละช่วงตามกราฟ R0 พร้อม interpolation ตำแหน่งบนภาพ (เส้นทาง schematic)
- UI: เริ่ม/หยุด, x1/x5/x20, +1 ชั่วโมง, +1 วัน, เลือก NPC, ตรวจชีวิต/ความทรงจำ, World Events
- บันทึกและโหลดสถานะด้วย localStorage ภายในเบราว์เซอร์, export/import JSON
- Seeded RNG และ snapshot replay ตรวจได้ (ผลเหมือนกันเมื่อ seed + state เท่ากัน)

## เริ่มใช้งาน

```bash
python3 -m http.server 8000
# open http://localhost:8000/nira.html
node --test tests/nira-map-contract.test.mjs
node tests/nira-living-world.test.mjs
```

## ขอบเขตที่ต้องไม่กล่าวเกินจริง

- **ยังไม่มี LLM Agent**: เป็น rule/utility AI ซึ่งไม่มีการเรียกผู้ให้บริการโมเดลภายนอก
- **ยังไม่มี always-on server**: ปิดหน้าเว็บหรือเปลี่ยนแท็บเป็น hidden จะไม่เดิน Tick ต่อ; Save เป็นของ browser/device นั้น
- **ยังไม่มี pixel collision หรือ pathfinding ระดับ Tilemap**: จุดและเส้นทางประเมินจากแผนที่ภาพ; ไม่ใช่ NavMesh ที่ทดสอบแล้ว
- **ยังไม่ใช่ engine เดิมของ Kingdom-sandbox**: R1 เป็น simulation module แยกและไม่แก้ `script.js` หรือ existing saves
- **ตลาดขั้นต้น**: เป็นระบบทรัพยากร/เงินและกิจวัตรสำหรับพิสูจน์แนวคิด ไม่ใช่เศรษฐกิจระดับอาณาจักรทั้งหมด
- Browser screenshot smoke ใน environment ที่มีข้อจำกัดอาจเป็น UNKNOWN; อย่าอ้าง PASS หากไม่ได้ทดสอบบนเบราว์เซอร์จริง

## ข้อกำหนด R2

1. ตรวจ topo ของเส้นทาง/bridge/sea จากพิกัดจริง
2. เชื่อมข้อมูล Market + Faction จาก Kingdom engine ด้วย adapter ที่ไม่ทำให้ save เก่าพัง
3. เพิ่ม Social Memory, Relationships และ NPC conversations
4. เพิ่ม persistence backend จริงแยกจาก localStorage พร้อม event log/ledger
5. จัดเก็บผลทดสอบ mobile/browser จริงและ snapshot restore ทุก release

ดู `docs/NIRA_R1_IMPLEMENTATION.md`
