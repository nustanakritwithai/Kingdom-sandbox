import {findShortestPath} from "./world/nira/navigation.mjs";
const dataRoot = './world/nira/';
const allFiles = ['manifest','regions','factions','locations','routes','resources','region_economy','spawn_setup'];
const $ = id => document.getElementById(id);
const state = {pack:null,image:null,selected:null,chosenRegion:'all',chosenRoute:null,zoom:1};
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
 $('atlasCanvas').addEventListener('click',e=>{const rect=e.currentTarget.getBoundingClientRect(),x=(e.clientX-rect.left)/rect.width*1536,y=(e.clientY-rect.top)/rect.height*1536;const loc=nearestLocation(x,y);if(loc){state.selected=loc.id;locationInspect(loc);render();}});
 ['showPins','showLinks','allowPortals'].forEach(k=>$(k).addEventListener('change',render));
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
  say('counts',`${state.pack.regions.length} regions · ${state.pack.factions.length} factions · ${state.pack.locations.length} locations · ${state.pack.routes.length} routes · ${state.pack.resources.length} resources`);
  say('loadStatus','World data loaded — R0 only');
  say('regionInfo','เลือกภูมิภาคเพื่อดูข้อมูล');
  const img=new Image();img.onload=()=>{state.image=img;say('assetInfo',`Canon map: ${img.width}×${img.height}\nR0 graphical overlay loaded. Geometry is approximate.`);render();};img.onerror=()=>{say('assetInfo','ยังไม่มีไฟล์ภาพ Canon Map ในการ Deploy นี้ เลือกไฟล์จากเครื่องเพื่อแสดงบนแผนที่ได้ (ข้อมูลพิกัด/เส้นทางโหลดแล้ว)');render();};img.src='./'+m.image_path;
  render();
 }catch(err){say('loadStatus','โหลดไม่สำเร็จ');say('counts',String(err.message||err));say('assetInfo','ต้องเปิดผ่าน Web server เช่น python3 -m http.server 8000 จากโฟลเดอร์ repo');}
}
load();
