import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLivingWorld,stepLivingWorld,snapshotLivingWorld,restoreLivingWorld,verifyLivingWorld,getAgentMapPosition,NIRA_R2_SCHEMA} from '../world/nira/living-world.mjs';
const dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(dirname,'../world/nira');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name+'.json'),'utf8'));
const pack=Object.fromEntries(['manifest','regions','factions','locations','routes','resources','region_economy','spawn_setup'].map(n=>[n,read(n)]));
const runner=(name,fn)=>{fn();console.log('PASS',name);};
runner('R1 spawns 30 stable NPCs across four R0 towns',()=>{
 const world=createLivingWorld(pack);assert.equal(world.schema,NIRA_R2_SCHEMA);assert.equal(world.agents.length,30);
 const ids=new Set(world.agents.map(x=>x.id));assert.equal(ids.size,30);
 assert.deepEqual([...new Set(world.agents.map(x=>x.homeId))].sort(),['loc_greenford','loc_niravale','loc_silverpeak','loc_solkar'].sort());
 assert.ok(world.agents.some(a=>a.profession==='farmer'));
 assert.ok(world.agents.some(a=>a.profession==='miner'));
});
runner('R1 hour tick changes world clock and meaningful work happens',()=>{
 const world=createLivingWorld(pack);stepLivingWorld(world,pack,15);
 assert.equal(world.tick,15);assert.equal(world.day,1);assert.equal(world.hour,21);
 assert.ok(world.stats.produced>0);assert.ok(world.agents.some(a=>a.workCount>0));
 assert.equal(verifyLivingWorld(world,pack).ok,true);
});
runner('R1 survives 30 simulated days without negative stocks or duplicate NPCs',()=>{
 const world=createLivingWorld(pack);for(let d=0;d<30;d++){stepLivingWorld(world,pack,24);const check=verifyLivingWorld(world,pack);assert.equal(check.ok,true,check.errors.join(';'));}
 assert.equal(world.agents.length,30);assert.ok(world.stats.journeys>0,'agents should make journey');assert.ok(world.stats.meals>0);assert.ok(world.stats.rests>0);
 assert.ok(world.events.length<=180);
 console.log('metrics',JSON.stringify(world.stats));
});
runner('R1 determinism by seed and exact checkpoint replay',()=>{
 const a=createLivingWorld(pack,{seed:'NIRA-REPLAY-7'});const b=createLivingWorld(pack,{seed:'NIRA-REPLAY-7'});
 for(let n=0;n<3;n++){stepLivingWorld(a,pack,24);stepLivingWorld(b,pack,24);}
 assert.deepEqual(a,b);
 const restored=restoreLivingWorld(pack,snapshotLivingWorld(a));
 for(let n=0;n<5;n++){stepLivingWorld(a,pack,24);stepLivingWorld(restored,pack,24);}
 assert.deepEqual(restored,a);
});
runner('R1 rejects broken snapshots and bad hours',()=>{
 const a=createLivingWorld(pack);assert.throws(()=>stepLivingWorld(a,pack,10000));
 const saved=snapshotLivingWorld(a);saved.agents[0].locationId='fictional';assert.throws(()=>restoreLivingWorld(pack,saved));
});
runner('R1 traveling agent stays on route graph',()=>{
 const world=createLivingWorld(pack);for(let n=0;n<20;n++)stepLivingWorld(world,pack,24);
 for(const a of world.agents){const pos=getAgentMapPosition(pack,a);assert.ok(pos&&Number.isFinite(pos.x)&&Number.isFinite(pos.y));}
 assert.equal(verifyLivingWorld(world,pack).ok,true);
});
console.log('R1 TESTS ALL PASSED');
