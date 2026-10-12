# The Realm of Nira — AI Living World R0

ชุดข้อมูลโลกจากภาพที่ผู้ใช้เลือก (ภาพต้นฉบับ 1536×1536) สำหรับต่อยอดใน `nustanakritwithai/Kingdom-sandbox`

## มีอะไรแล้ว

- ภาพแผนที่ต้นฉบับ: `world/nira/assets/nira_world_map.jpg`
- JSON: 13 ภูมิภาค, 11 กลุ่มอำนาจ, 55 สถานที่, 68 เส้นทาง, 28 ทรัพยากร, เศรษฐกิจภูมิภาค และแผนประชากรเริ่มต้น 30/132 คน
- Interactive Atlas: `nira.html` + `nira.js` + `nira.css` เปิดดูจุดสำคัญ เลือกพื้นที่ วางเส้นทางบนกราฟ และแสดงข้อมูลประกอบ
- Pathfinding แบบ Graph ใช้ Dijkstra (`world/nira/navigation.mjs`)
- Legacy compatibility projection (`world/nira/legacy_adapter.mjs`) แบบไม่เขียนแก้สถานะเกมเดิม
- Unit tests (`tests/nira-map-contract.test.mjs`) ตรวจความถูกต้องของข้อมูล ความเชื่อมโยง การเดินเรือ และเส้นทาง

## เปิดดูแผนที่บนเครื่อง

1. แตก ZIP และเปิด Terminal ที่โฟลเดอร์โปรเจกต์
2. รัน `python3 -m http.server 8000`
3. เปิด `http://localhost:8000/nira.html`
4. ติ๊ก “เส้นทางทั้งหมด” หรือเลือกเมืองสองเมืองเพื่อคำนวณเส้นทาง
5. สำหรับการทดสอบ ใช้ `node --test tests/nira-map-contract.test.mjs` (ต้องมี Node.js)

## เพิ่มไฟล์ลง GitHub

เพื่อไม่กระทบเกมหลัก ให้นำไฟล์ทั้งหมดใน ZIP ไปเพิ่มใน Branch `feat/nira-living-world-r0` ของ `nustanakritwithai/Kingdom-sandbox` โดยคงพาธตรงตาม ZIP **และอย่าเขียนทับ `script.js`, `index.html`, หรือ `main`** จากนั้นจึงเปิด Pull Request ให้ตรวจรับก่อน Merge

## สถานะ / ข้อจำกัด

- **R0 DATA ONLY:** ยังไม่มี NPC AI ที่ทำงานจริง หรือเซิร์ฟเวอร์จำลองเวลา 24/7
- ตำแหน่งสถานที่เป็นการระบุโดยประมาณบนภาพต้นฉบับ ไม่ใช่พิกัดเดินจริง
- เส้นทางกราฟเป็นสมมติฐานสำหรับการนำทางขั้นต้น ต้องตรวจด้วยทางบก สะพาน ท่าเรือ และชนิดภูมิประเทศก่อนให้ NPC เคลื่อนจริง
- จำนวน NPC 30 / 132 เป็นเป้าหมายตั้งต้น ยังไม่ถูก Spawn
- Browser screenshot smoke ยังไม่ตรวจยืนยัน แม้ข้อมูลและโค้ด JS ผ่านการตรวจอัตโนมัติ
- ดูลำดับต่อไปใน `docs/NIRA_R0_INTEGRATION.md`

## เผยแพร่ GitHub Pages

เปิด `/nira.html` หรือ `/nira/` จาก GitHub Pages ของรีโปหลัก เว็บใช้ภาพ Canon ขนาด 1536×1536 ที่เข้ารหัส WebP เพื่อความเร็ว ส่วนไฟล์ต้นฉบับอยู่ใน ZIP ส่งมอบแยกต่างหาก ไม่ใช่ระบบ AI NPC ที่รันต่อเนื่อง
