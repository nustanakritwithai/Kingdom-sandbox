# Living Kingdom Sandbox

โลกจำลองอาณาจักรยุคกลางแบบ **AI Economy + War + Governance Simulator** สไตล์ WorldBox
ผู้เล่นไม่ควบคุมตัวละครใดๆ — ทุกอย่างขับเคลื่อนด้วยการตัดสินใจของ AI แต่ละตัว ผู้เล่นเป็นเพียง
ผู้สังเกตการณ์ / god-mode / นักทดลองระบบ

> «โลกไม่ได้หมุนตามผู้เล่น แต่หมุนตามการตัดสินใจของ AI ทุกตัว»

## วิธีเล่น

เปิด `index.html` ใน browser ได้ทันที — ไม่ต้องติดตั้งอะไร ไม่มี dependency (HTML/CSS/JavaScript ล้วน)

```bash
# หรือเสิร์ฟผ่าน local server
python3 -m http.server 8000
# แล้วเปิด http://localhost:8000
```

- **คลิก** ตัวละคร / เมือง / คาราวาน / กองกำลัง เพื่อดูข้อมูลละเอียดใน Inspector Panel
- **Toolbar**: Pause / Resume, ความเร็ว x1 x5 x20, เดินหน้าทีละวัน, Reset โลกใหม่
- **Heatmap**: ความหิว, ความรวย, อันตราย, การค้า, ราคาอาหาร, loyalty, unrest, เขตอิทธิพล faction
- **Sandbox Tools**: เพิ่มคน / พ่อค้า / โจร, ทำให้ขาดอาหาร, ภัยแล้ง, โรคระบาด, ปล่อยกบฏ,
  สร้าง/ทำลายถนน, เพิ่มหมู่บ้าน/เมือง/ป้อม, ก่อสงคราม ฯลฯ แล้วเฝ้าดูว่าโลกปรับตัวอย่างไร

## ระบบหลัก

| ระบบ | รายละเอียด |
|---|---|
| ตัวละคร AI | hunger, energy, health, morale, เงิน, inventory (มี durability), สกิล 15 แบบโตจากการกระทำจริง, traits, ความคิดปัจจุบันอ่านได้ |
| Utility AI | ตัวละครเลือกงาน เปลี่ยนอาชีพ ย้ายเมือง เข้าร่วมกองทัพ หรือเป็นโจร ตามคะแนน benefit − risk − cost |
| เศรษฐกิจ stock-flow | ของทุกชิ้นเป็นของจริงในคลัง ราคา = base × scarcity × danger × tax พ่อค้าคำนวณกำไรคาดหวังแล้วขนของด้วยคาราวานที่ถูกปล้นได้จริง |
| โจร | ดักเส้นทางที่คาราวานพลุกพล่าน ปล้นหมู่บ้านที่ป้องกันอ่อน ตั้ง warband ค่ายอดอยากแล้วโจรกลับตัว |
| ทหาร | unit/army จาก agent จริง, recruitment, command capacity, battle simulation แบบตัวเลข, เลื่อนขั้น, garrison กินเสบียง+ค่าจ้างจริง |
| การปกครอง | ภาษี คลังเมือง governor (โกงได้ กบฏได้ ประกาศเอกราชได้) อาคาร 8 แบบสร้างด้วยทรัพยากรจริง raid / capture / siege |
| การเมือง | faction, ราชา, การสืบทอดอำนาจ, กบฏประชาชน, สงครามกลางเมือง, event log บันทึกประวัติศาสตร์ |

## โครงสร้างไฟล์

```
index.html   — โครงหน้า UI (toolbar / map / inspector / event log)
style.css    — ธีมและ layout
script.js    — เอนจินจำลองทั้งหมด แบ่งเป็น 18 section (world gen, economy, AI, military, governance, renderer, UI)
```
