import {findShortestPath} from "./world/nira/navigation.mjs";
import {createLivingWorld,stepLivingWorld,getAgentMapPosition,snapshotLivingWorld,restoreLivingWorld} from "./world/nira/living-world.mjs";
const dataRoot = './world/nira/';
const allFiles = ['manifest','regions','factions','locations','routes','resources','region_economy','spawn_setup'];
const $ = id => document.getElementById(id);
const state = {pack:null,image:null,selected:null,chosenRegion:'all',chosenRoute:null,zoom:1,simulation:null,selectedNPC:null,simRunning:false,simSpeed:1};
function say(id,value){$(id).textContent=value;}
function locName(id){return state.pack.locations.find(x=>x.id===id)?.name||id;}
function regionName(id){return state.pack.regions.find(x=>x.id===id)?.name||id;}
function badge(el,text){const span=document.createElement('span');span.textContent=text;el.appendChild(span);}
function option(select,value,label){const op=document.createElement('option');op.value=value;op.textContent=label;select.appendChild(op);}
function nearestLocation(x,y){let best=null,dist=Number.POSITIVE_INFINITY;for(const loc of state.pack.locations){if(state.chosenRegion!=='all' && loc.region_id!==state.chosenRegion)continue;const d=Math.hypot(x-loc.map_x,y-loc.map_y);if(d<dist){dist=d;best=loc;}}return dist<27?best:null;}
function render(){
 const cv=$('atlasCanvas'),ctx=cv.getContext('2d'),W=cv.width,H=cv.height;
 ctx.clearRect(0,0,W,H);
 if(state.image){ctx.drawImage(state.image,0,0,W,H);}else{ctx.fillStyle='#07365e';ctx.fillRect(0,0,W,H);ctx.fillStyle='#d3eaff';ctx.font='bold 38px sans-serif';ctx.textAlign='center';ctx.fillText('SELECT THE CANON NIRA MAP IMAGE',W/2,H/2);}
 const locById=new Map(state.pack.locations.map(loc=>[loc.id,loc]));
 const drawingRoute=(r,highlight=false)=>{
  const a=locById.get(r.from_location_id),b=locById.get(r.to_location_id);if(!a||!b)return;
  ctx.beginPath();ctx.moveTo(a.map_x,a.map_y);for(const p of r.via||[])ctx.lineTo(p.x,p.y);ctx.lineTo(b.map_x,b.map_y);
  ctx.lineWidth=highlight?9:3;ctx.strokeStyle=highlight?'#ffe58b':r.mode==='sea'?'rgba(120,230,255,.75)':r.mode==='portal'?'#e6a1ff':'rgba(255,255,255,.62)';
  ctx.setLineDash(r.mode==='sea'?[12,8]:r.mode==='portal'?[4,12]:[]);ctx.stroke();ctx.setLineDash([]);
 };
 if($('showLinks').checked)state.pack.routes.filter(r=>r.mode!=='portal'||$('allowPortals').checked).forEach(r=>drawingRoute(r,false));
 if(state.chosenRoute)state.chosenRoute.routes.forEach(r=>drawingRoute(r,true));
 if($('showPins').checked){
   for(const loc of state.pack.locations){
     if(state.chosenRegion!=='all'&&loc.region_id!==state.chosenRegion)continue;
     const active=loc.id===state.selected;
     ctx.beginPath();ctx.arc(loc.map_x,loc.map_y,active?16:9,0,Math.PI*2);
     ctx.fillStyle=active?'#ffe071':loc.type==='dungeon'?'#d08bfa':loc.type==='port'?'#70dcff':'#ffffff';ctx.fill();
     ctx.lineWidth=4;ctx.strokeStyle='#142333';ctx.stroke();
     if(active){ctx.font='bold 23px system-ui';ctx.textAlign='left';ctx.lineWidth=5;ctx.strokeStyle='#092b44';ctx.strokeText(loc.name,loc.map_x+20,loc.map_y+8);ctx.fillStyle='white';ctx.fillText(loc.name,loc.map_x+20,loc.map_y+8);}
   }
 }
 drawNPCs(ctx);
}
function locationInspect(loc){
 const faction=state.pack.factions.find(f=>f.id===loc.owner_faction_id);
 say('selectedLocation',`${loc.name}\nType: ${loc.type}\nRegion: ${regionName(loc.region_id)}\nFaction: ${faction?.name||'Independent'}\nMap coordinates: ${loc.map_x}, ${loc.map_y}\nSea access: ${loc.sea_access?'yes':'no'}\nMap anchor: ${loc.anchor_status}\nServices: ${loc.services.join(', ')||'—'}`);
}
function bindUI(){
 const pack=state.pack;
 option($('regionSelect'),'all','ทุกภูมิภาค');for(const region of pack.regions)option($('regionSelect'),region.id,region.name);
 for(const loc of pack.locations){option($('fromSelect'),loc.id,loc.name);option($('toSelect'),loc.id,loc.name);}
 $('fromSelect').value='loc_niravale';$('toSelect').value='loc_solkar';
 $('regionSelect').addEventListener('change',e=>{state.chosenRegion=e.target.value;const r=pack.regions.find(x=>x.id===e.target.value);say('regionInfo',r?`${r.description_th}\nBiome: ${r.biome}\nDanger index: ${r.danger_index}/100\nจำนวนจุดสำคัญ: ${pack.locations.filter(l=>l.region_id===r.id).length}`:'แสดงทุกภูมิภาค');render();});
 $('findRoute').addEventListener('click',()=>{const p=findShortestPath(state.pack,$('fromSelect').value,$('toSelect').value,{allowPortals:$('allowPortals').checked});state.chosenRoute=p;say('routeResult',p?`${p.nodes.map(locName).join(' → ')}\n${p.routes.length} legs, ${p.units} abstract travel units\nModes: ${p.routes.map(x=>x.mode).join(', ')||'same location'}\nRisk is per leg; segment lines are schematic.`:'ไม่พบเส้นทางภายใต้ข้อจำกัดที่เลือก');render();});
 $('atlasCanvas').addEventListener('click',e=>{const rect=e.currentTarget.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width*1536,y=(e.clientY-rect.top)/rect.height*1536;const agent=agentAt(x,y);if(agent){state.selectedNPC=agent.id;renderAgentPanel();render();return;}const loc=nearestLocation(x,y);if(loc){state.selected=loc.id;locationInspect(loc);render();}});
 ['showPins','showLinks','allowPortals','showNPC'].forEach(k=>$(k).addEventListener('change',render));
 $('zoomIn').addEventListener('click',()=>{state.zoom=Math.min(3,state.zoom+0.25);$('atlasCanvas').style.width=(state.zoom*100)+'%';});
 $('zoomOut').addEventListener('click',()=>{state.zoom=Math.max(1,state.zoom-0.25);$('atlasCanvas').style.width=(state.zoom*100)+'%';});
 $('pickMap').addEventListener('change',e=>{const file=e.target.files?.[0];if(!file)return;const url=URL.createObjectURL(file);const img=new Image();img.onload=()=>{if(state.objectUrl)URL.revokeObjectURL(state.objectUrl);state.objectUrl=url;state.image=img;say('assetInfo',`โหลดภาพจากเครื่องสำเร็จ: ${file.name} (${img.width}×${img.height})\nใช้แสดงผลภายในเบราว์เซอร์เท่านั้น ไม่ได้อัปโหลดไปเซิร์ฟเวอร์`);render();};img.onerror=()=>{URL.revokeObjectURL(url);say('assetInfo','ไม่สามารถเปิดภาพที่เลือกได้');};img.src=url;});
}
async function load(){
 try{
  const entries=await Promise.all(allFiles.map(async f=>{const response=await fetch(dataRoot+f+'.json',{cache:'no-store'});if(!response.ok)throw Error(`Missing ${f}.json (${response.status})`);return [f,await response.json()];}));
  state.pack=Object.fromEntries(entries);
  const m=state.pack.manifest;
  if(m.coordinate_system.width!==1536||m.coordinate_system.height!==1536)throw Error('Map dimension mismatch');
  bindUI();
  setupLivingWorld();
  say('counts',`${state.pack.regions.length} regions · ${state.pack.factions.length} factions · ${state.pack.locations.length} locations · ${state.pack.routes.length} routes · ${state.pack.resources.length} resources`);
  say('loadStatus','R2 Living Society — local autonomous NPCs');
  say('regionInfo','เลือกภูมิภาคเพื่อดูข้อมูล');
  const img=new Image();img.onload=()=>{state.image=img;say('assetInfo',`Canon map: ${img.width}×${img.height}\nR0 graphical overlay loaded. Geometry is approximate.`);render();};img.onerror=()=>{say('assetInfo','ยังไม่มีไฟล์ภาพ Canon Map ในการ Deploy นี้ เลือกไฟล์จากเครื่องเพื่อแสดงบนแผนที่ได้ (ข้อมูลพิกัด/เส้นทางโหลดแล้ว)');render();};img.src='./'+m.image_path;
  render();
 }catch(err){say('loadStatus','โหลดไม่สำเร็จ');say('counts',String(err.message||err));say('assetInfo','ต้องเปิดผ่าน Web server เช่น python3 -m http.server 8000 จากโฟลเดอร์ repo');}
}
// Nira R2 observer controls. Browser-only simulation with bounded social memory; no LLM provider.
const SAVE_KEY='nira-r2-world-save-v1';
const OLD_SAVE_KEY='nira-r1-world-save-v1';
const JOB_COLORS={farmer:'#ffc773',trader:'#78e5fa',guard:'#f87c7c',miner:'#b1adfa',woodcutter:'#92df8b',crafter:'#ffc98d',healer:'#88f4c5',explorer:'#ffffff',fisherman:'#58adff'};
let simLoop=null;
const agentColor=a=>JOB_COLORS[a.profession]||'#fff';
function currentNPC(){return state.simulation?.agents.find(a=>a.id===state.selectedNPC)||null;}
function displayPosition(agent){
 const pt=getAgentMapPosition(state.pack,agent);
 if(!pt)return null;
 const suffix=Number(agent.id.split('_').at(-1))||1;
 const dx=Math.cos(suffix*2.399963)*((suffix%5)+1)*2.5;
 const dy=Math.sin(suffix*2.399963)*((suffix%5)+1)*2.5;
 return {x:pt.x+dx,y:pt.y+dy,traveling:pt.traveling};
}
function drawNPCs(ctx){
 if(!state.simulation||!$('showNPC').checked)return;
 for(const a of state.simulation.agents){
  const pos=displayPosition(a);if(!pos)continue;
  const selected=a.id===state.selectedNPC;
  ctx.beginPath();ctx.arc(pos.x,pos.y,selected?13:7,0,Math.PI*2);
  ctx.fillStyle=agentColor(a);ctx.fill();ctx.lineWidth=selected?5:3;ctx.strokeStyle=selected?'#151e40':'#162d42';ctx.stroke();
  if(pos.traveling){ctx.beginPath();ctx.arc(pos.x,pos.y,selected?19:11,0,Math.PI*2);ctx.strokeStyle='#ffe28d';ctx.lineWidth=2;ctx.stroke();}
  if(selected){ctx.font='bold 20px system-ui';ctx.textAlign='left';ctx.lineWidth=5;ctx.strokeStyle='#092b44';ctx.strokeText(a.name,pos.x+22,pos.y-6);ctx.fillStyle='white';ctx.fillText(a.name,pos.x+22,pos.y-6);}
 }
}
function agentAt(x,y){
 if(!$('showNPC').checked||!state.simulation)return null;
 let winner=null,best=17;
 for(const a of state.simulation.agents){const p=displayPosition(a);if(!p)continue;const d=Math.hypot(p.x-x,p.y-y);if(d<best){best=d;winner=a;}}
 return winner;
}
function saveLocal(announce=true){
 try{localStorage.setItem(SAVE_KEY,JSON.stringify(snapshotLivingWorld(state.simulation)));if(announce)notice('บันทึกสถานะโลกไว้ในเบราว์เซอร์นี้แล้ว');return true;}
 catch(err){notice('บันทึกไม่ได้: '+err.message);return false;}
}
function notice(s){say('simNotice',s);}
function renderAgentPanel(){
 const world=state.simulation;if(!world)return;
 say('simClock',`Day ${world.day} · ${String(world.hour).padStart(2,'0')}:00`);
 say('simMetrics',`${world.agents.length} NPC · ${world.agents.filter(a=>!!a.travel).length} กำลังเดินทาง · การค้า ${world.stats.delivered} เที่ยว · ผลิต ${world.stats.produced} หน่วย · ผ่าน ${world.tick} ชั่วโมง`);
 $('simToggle').textContent=state.simRunning?'⏸ หยุด':'▶ ดำเนินต่อ';
 const filter=$('npcFilter').value.trim().toLowerCase();
 const list=$('npcList');list.replaceChildren();
 const filtered=world.agents.filter(a=>!filter||`${a.name} ${a.profession} ${locName(a.locationId)}`.toLowerCase().includes(filter));
 for(const a of filtered){
  const row=document.createElement('button');row.type='button';row.className='npc-row'+(a.id===state.selectedNPC?' active':'');row.setAttribute('aria-label',`เลือก ${a.name}`);
  const dot=document.createElement('i');dot.className='npc-dot';dot.style.background=agentColor(a);
  const name=document.createElement('span');name.className='npc-row-name';name.textContent=a.name;
  const job=document.createElement('span');job.className='npc-row-job';job.textContent=a.profession;
  row.append(dot,name,job);row.addEventListener('click',()=>{state.selectedNPC=a.id;renderAgentPanel();render();});list.appendChild(row);
 }
 if(!filtered.length){const empty=document.createElement('p');empty.className='hint';empty.textContent='ไม่พบ NPC';list.appendChild(empty);}
 const a=currentNPC();
 say('npcInspector',a?`${a.name} (${a.id})\nอาชีพ: ${a.profession}\nบ้าน: ${locName(a.homeId)}\nปัจจุบัน: ${locName(a.locationId)}${a.travel?' → '+locName(a.travel.to):''}\nเป้าหมาย: ${a.goal}\nกิจกรรม: ${a.activity}\nเงิน: ${a.gold} เหรียญ · หิว: ${Math.round(a.hunger)}/100 · พลังงาน: ${Math.round(a.energy)}/100\nเดินทางสำเร็จ: ${a.visits} · ชั่วโมงทำงาน: ${a.workCount}\nสินค้า: ${a.cargo?`${a.cargo.good} ×${a.cargo.quantity}`:'ไม่มี'}\n\nความทรงจำล่าสุด:\n${a.stories.slice(-4).map(x=>`D${x.day} ${String(x.hour).padStart(2,'0')}:00 ${x.message}`).join('\n')||'ยังไม่มีเหตุการณ์สำคัญ'}`:'เลือก NPC จากรายชื่อหรือคลิกเครื่องหมายบนแผนที่');
 const social=a?.social;
 say('socialStats',`พบปะ ${world.stats.socialMeetings} ครั้ง · ช่วยเหลือ ${world.stats.socialHelp} ครั้ง · แลกข่าว ${world.stats.knowledgeShared} ครั้ง · ขัดแย้ง ${world.stats.socialDisputes} ครั้ง`);
 const names=new Map(world.agents.map(agent=>[agent.id,agent.name]));
 const relations=social?Object.entries(social.relations).sort((left,right)=>right[1].trust-left[1].trust||left[0].localeCompare(right[0])):[];
 say('npcRelations',relations.length?relations.slice(0,8).map(([id,rel])=>`${names.get(id)||id}: ไว้ใจ ${rel.trust}/100 · พบ ${rel.contacts} ครั้ง${rel.helped?` · ช่วย ${rel.helped} ครั้ง`:''}`).join('\n'):'ยังไม่พบคนรู้จัก');
 const beliefs=social?Object.values(social.beliefs).sort((left,right)=>right.updatedTick-left.updatedTick):[];
 say('npcBeliefs',beliefs.length?beliefs.slice(0,6).map(b=>`${locName(b.locationId)}: อาหาร${b.value==='scarce'?'ขาดแคลน':'เพียงพอ'} · ${b.status==='observed'?'สังเกตเอง':'ข่าวบอกต่อจาก '+(names.get(b.sourceAgentId)||b.sourceAgentId)} · ความเชื่อมั่น ${Math.round(b.confidence*100)}%`).join('\n'):'NPC ยังไม่มีข้อมูลตลาด');
 const socialFeed=$('socialFeed');socialFeed.replaceChildren();
 for(const item of (world.social?.events||[]).slice(-8).reverse()){
  const line=document.createElement('div');line.className='event-line';
  const time=document.createElement('time');time.textContent=`D${item.day} ${String(item.hour).padStart(2,'0')}:00`;
  const desc=document.createElement('span');desc.textContent=item.summary;
  line.append(time,desc);socialFeed.appendChild(line);
 }
 const events=$('npcEvents');events.replaceChildren();
 for(const e of world.events.slice(-11).reverse()){
  const line=document.createElement('div');line.className='event-line';
  const time=document.createElement('time');time.textContent=`D${e.day} ${String(e.hour).padStart(2,'0')}:00`;
  const msg=document.createElement('span');msg.textContent=e.message;
  line.append(time,msg);events.appendChild(line);
 }
}
function advanceHours(n){
 if(!state.simulation)return;
 try{
  const before=state.simulation.day;
  stepLivingWorld(state.simulation,state.pack,n);
  if(state.simulation.day!==before)saveLocal(false);
  renderAgentPanel();render();
 }catch(err){state.simRunning=false;notice('จำลองหยุดจากข้อผิดพลาด: '+err.message);renderAgentPanel();}
}
function chooseSpeed(speed){state.simSpeed=speed;document.querySelectorAll('[data-sim-speed]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.simSpeed)===speed));}
function bindSimUI(){
 $('simToggle').addEventListener('click',()=>{state.simRunning=!state.simRunning;notice(state.simRunning?'กำลังจำลองในแท็บนี้':'หยุดเวลาไว้ชั่วคราว');renderAgentPanel();});
 $('simHour').addEventListener('click',()=>advanceHours(1));
 $('simDay').addEventListener('click',()=>advanceHours(24));
 $('simReset').addEventListener('click',()=>{if(!confirm('เริ่มโลก Nira ใหม่? ค่าที่บันทึกเดิมจะถูกแทนที่'))return;state.simRunning=false;state.simulation=createLivingWorld(state.pack);state.selectedNPC=state.simulation.agents[0].id;saveLocal(false);notice('รีเซ็ตโลกและสร้าง NPC 30 ตัวใหม่พร้อมระบบสังคม R2');renderAgentPanel();render();});
 $('simSave').addEventListener('click',()=>saveLocal());
 $('simLoad').addEventListener('click',()=>{try{const raw=localStorage.getItem(SAVE_KEY);if(!raw){notice('ยังไม่มีข้อมูลที่บันทึก');return;}state.simulation=restoreLivingWorld(state.pack,raw);state.selectedNPC=state.simulation.agents[0].id;state.simRunning=false;notice('โหลดสถานะโลกสำเร็จ');renderAgentPanel();render();}catch(err){notice('ไม่สามารถโหลดข้อมูล: '+err.message);}});
 $('simExport').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify(snapshotLivingWorld(state.simulation),null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=`nira-r2-day-${state.simulation.day}.json`;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  notice('ส่งออกไฟล์ JSON ของสถานะโลกแล้ว');
 });
 $('simImportFile').addEventListener('change',async(e)=>{
  const file=e.target.files?.[0];if(!file)return;
  try{if(file.size>5_000_000)throw Error('ไฟล์ใหญ่เกิน 5 MB');const raw=await file.text();const restored=restoreLivingWorld(state.pack,raw);state.simulation=restored;state.simRunning=false;state.selectedNPC=restored.agents[0].id;saveLocal(false);notice('นำเข้า Snapshot สำเร็จ');renderAgentPanel();render();}
  catch(err){notice('นำเข้าไม่สำเร็จ: '+err.message);}finally{e.target.value='';}
 });
 $('npcFilter').addEventListener('input',renderAgentPanel);
 for(const b of document.querySelectorAll('[data-sim-speed]'))b.addEventListener('click',()=>chooseSpeed(Number(b.dataset.simSpeed)));
 chooseSpeed(1);
}
function setupLivingWorld(){
 state.simRunning=true;
 state.simSpeed=1;
 let restored=false;
 try{const saved=localStorage.getItem(SAVE_KEY)||localStorage.getItem(OLD_SAVE_KEY);if(saved){state.simulation=restoreLivingWorld(state.pack,saved);restored=true;saveLocal(false);}}
 catch(err){notice('ข้อมูลเดิมไม่รองรับเวอร์ชันนี้ จะเริ่มโลกใหม่: '+err.message);}
 if(!state.simulation)state.simulation=createLivingWorld(state.pack);
 state.selectedNPC=state.simulation.agents[0].id;
 bindSimUI();renderAgentPanel();
 notice(restored?'คืนสถานะโลกที่บันทึกและอัปเกรดเซฟเดิมแล้ว':'NPC เริ่มใช้ชีวิตและสร้างความสัมพันธ์ — จำลองเฉพาะเมื่อเปิดหน้านี้');
 if(simLoop)clearInterval(simLoop);
 simLoop=setInterval(()=>{
  if(!state.simRunning||document.visibilityState==='hidden')return;
  advanceHours(state.simSpeed);
 },850);
}

load();
