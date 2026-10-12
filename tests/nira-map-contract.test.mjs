import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildKingdomR0Projection } from '../world/nira/legacy_adapter.mjs';
import { findShortestPath } from '../world/nira/navigation.mjs';
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const load=name=>JSON.parse(fs.readFileSync(path.join(dir,'world/nira',name+'.json'),'utf8'));
const pack=Object.fromEntries(['manifest','regions','factions','locations','routes','resources','region_economy','spawn_setup'].map(n=>[n,load(n)]));
const ids=arr=>new Set(arr.map(x=>x.id));
const regionIds=ids(pack.regions),factionIds=ids(pack.factions),locationIds=ids(pack.locations),resourceIds=ids(pack.resources);
test('canonical source image and coordinate frame',()=>{
 assert.equal(pack.manifest.coordinate_system.width,1536);
 assert.equal(pack.manifest.coordinate_system.height,1536);
 assert.ok(fs.existsSync(path.join(dir,pack.manifest.image_path)));
 const head=fs.readFileSync(path.join(dir,pack.manifest.image_path)).subarray(0,12);
 if (pack.manifest.image_path.endsWith('.webp')) {
   assert.equal(head.subarray(0,4).toString('ascii'),'RIFF');
   assert.equal(head.subarray(8,12).toString('ascii'),'WEBP');
 } else {
   assert.deepEqual([...head.subarray(0,3)],[255,216,255]);
 }
});
test('IDs unique and all references valid',()=>{
 for(const name of ['regions','factions','locations','resources','routes'])assert.equal(ids(pack[name]).size,pack[name].length,`${name} duplicate ID`);
 for(const r of pack.regions){assert.ok(factionIds.has(r.initial_faction_id));for(const k of r.resource_ids)assert.ok(resourceIds.has(k),k)}
 for(const f of pack.factions){assert.ok(regionIds.has(f.home_region_id));assert.ok(locationIds.has(f.seat_location_id));for(const k of Object.keys(f.relations))assert.ok(factionIds.has(k));}
 for(const l of pack.locations){assert.ok(regionIds.has(l.region_id),l.id);assert.ok(factionIds.has(l.owner_faction_id),l.id);assert.ok(l.map_x>=0&&l.map_x<=1536&&l.map_y>=0&&l.map_y<=1536,l.id)}
 for(const r of pack.routes){assert.ok(locationIds.has(r.from_location_id),r.id);assert.ok(locationIds.has(r.to_location_id),r.id);assert.notEqual(r.from_location_id,r.to_location_id);assert.ok(r.distance_units>0);assert.ok(r.risk>=0&&r.risk<=1);for(const p of r.via||[])assert.ok(p.x>=0&&p.x<=1536&&p.y>=0&&p.y<=1536);}
 for(const e of pack.region_economy){assert.ok(regionIds.has(e.region_id));for(const key of ['produces','consumes','exports','imports'])for(const r of e[key])assert.ok(resourceIds.has(r),r)}
});
test('ports required for every sea edge; gated portal routes',()=>{
 const byId=new Map(pack.locations.map(l=>[l.id,l]));
 for(const r of pack.routes){if(r.mode==='sea'){assert.ok(byId.get(r.from_location_id).sea_access,r.id);assert.ok(byId.get(r.to_location_id).sea_access,r.id)}if(r.mode==='portal')assert.ok(r.unlock_flag,r.id)}
});
test('every location is reachable in travel graph without portals',()=>{
 const graph=new Map(pack.locations.map(l=>[l.id,[]]));
 for(const r of pack.routes){if(r.mode==='portal')continue;graph.get(r.from_location_id).push(r.to_location_id);if(r.bidirectional)graph.get(r.to_location_id).push(r.from_location_id);}
 const seen=new Set(),stack=[pack.locations[0].id];while(stack.length){const id=stack.pop();if(seen.has(id))continue;seen.add(id);stack.push(...graph.get(id));}
 assert.equal(seen.size,pack.locations.length,'unreachable: '+pack.locations.filter(l=>!seen.has(l.id)).map(l=>l.id).join(', '));
});
test('spawn profiles counts match references',()=>{
 for(const [key,profile] of Object.entries(pack.spawn_setup.profiles)){
  assert.equal(profile.locations.reduce((n,l)=>n+l.count,0),profile.target_agents,key);
  for(const s of profile.locations)assert.ok(locationIds.has(s.location_id));
 }
});
test('legacy projection is separate and non-mutating',()=>{
 const before=JSON.stringify(pack);
 const out=buildKingdomR0Projection(pack);
 assert.equal(out.status,'PREVIEW_ONLY_NOT_APPLIED_TO_LIVE_ENGINE');
 assert.ok(out.settlements.length>15);
 assert.equal(JSON.stringify(pack),before);
});

test('route planner resolves realistic graph without portals',()=>{
 const result=findShortestPath(pack,'loc_niravale','loc_azurea');
 assert.ok(result);assert.equal(result.nodes[0],'loc_niravale');assert.equal(result.nodes.at(-1),'loc_azurea');
 assert.ok(result.routes.some(r=>r.mode==='sea'));
 assert.ok(result.routes.every(r=>r.mode!=='portal'));
 assert.ok(result.units>0);
});
test('route planner rejects unknown locations and keeps same-point routing empty',()=>{
 assert.equal(findShortestPath(pack,'unknown','loc_niravale'),null);
 assert.deepEqual(findShortestPath(pack,'loc_niravale','loc_niravale').nodes,['loc_niravale']);
});
