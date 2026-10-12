import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLivingWorld,restoreLivingWorld,snapshotLivingWorld,verifyLivingWorld} from '../world/nira/living-world.mjs';
import {resolveSocialEncounter,tickSocialWorld} from '../world/nira/social-world.mjs';
const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../world/nira');
const pack=Object.fromEntries(['manifest','regions','factions','locations','routes','resources','region_economy','spawn_setup']
  .map(k=>[k,JSON.parse(fs.readFileSync(path.join(base,k+'.json'),'utf8'))]));
function scenario(stock){
  const world=createLivingWorld(pack,{seed:'R2-VERIFY-101'});
  const source=world.agents[0];
  const receiver=world.agents.find(a=>a.homeId==='loc_solkar');
  assert.ok(source&&receiver);
  const key='food:loc_niravale';
  source.social.beliefs[key]={key,locationId:'loc_niravale',kind:'food_supply',value:'available',
    status:'observed',sourceAgentId:null,originAgentId:source.id,confidence:1,relayDepth:0,
    observedDay:world.day,updatedTick:world.tick};
  source.temperament.sociability=1;
  source.locationId='loc_greenford';
  receiver.locationId='loc_greenford';
  const beforeMarkets=JSON.stringify(world.markets);
  resolveSocialEncounter(world,pack,source,receiver);
  assert.equal(receiver.social.beliefs[key].status,'reported');
  assert.equal(JSON.stringify(world.markets),beforeMarkets,'hearsay cannot mutate market truth');
  const trustBefore=receiver.social.relations[source.id].trust;
  world.markets.loc_niravale.stock.grain=stock;
  world.markets.loc_niravale.stock.fish=stock;
  receiver.locationId='loc_niravale';
  receiver.social.lastObservedDay=-1;
  world.hour=10;
  tickSocialWorld(world,pack);
  return {world,source,receiver,key,trustBefore};
}
test('R2.1 verifies true hearsay after the listener visits the reported market',()=>{
 const {world,source,receiver,key,trustBefore}=scenario(90);
 assert.equal(world.stats.socialConfirmedReports,1);
 assert.equal(world.stats.socialCorrectedReports,0);
 assert.equal(receiver.social.beliefs[key].status,'observed');
 assert.equal(receiver.social.relations[source.id].trust,trustBefore+4);
 assert.ok(world.social.events.some(e=>e.kind==='CONFIRMED'));
 assert.ok(verifyLivingWorld(world,pack).ok);
});
test('R2.1 corrects outdated hearsay using firsthand evidence, without inventing goods',()=>{
 const {world,source,receiver,key,trustBefore}=scenario(0);
 assert.equal(world.stats.socialCorrectedReports,1);
 assert.equal(world.stats.socialConfirmedReports,0);
 assert.equal(receiver.social.beliefs[key].value,'scarce');
 assert.equal(receiver.social.relations[source.id].trust,trustBefore-7);
 assert.ok(receiver.social.memories.some(e=>e.kind==='corrected'));
 assert.ok(world.social.events.some(e=>e.kind==='CORRECTED'));
 assert.ok(verifyLivingWorld(world,pack).ok);
});
test('R2.1 restores older valid R2 save with missing verification counters, retaining R1 data',()=>{
 const world=createLivingWorld(pack);
 const snapshot=snapshotLivingWorld(world);
 delete snapshot.stats.socialConfirmedReports;
 delete snapshot.stats.socialCorrectedReports;
 const restored=restoreLivingWorld(pack,snapshot);
 assert.equal(restored.stats.socialConfirmedReports,0);
 assert.equal(restored.stats.socialCorrectedReports,0);
 assert.deepEqual(restored.markets,world.markets);
 assert.deepEqual(restored.agents.map(x=>x.id),world.agents.map(x=>x.id));
 assert.ok(verifyLivingWorld(restored,pack).ok);
});
test('R2.1 rejects illegal negative counters in newly saved social snapshot',()=>{
 const world=createLivingWorld(pack);
 const saved=snapshotLivingWorld(world);
 saved.stats.socialCorrectedReports=-1;
 assert.throws(()=>restoreLivingWorld(pack,saved),/Invalid social state/);
});
