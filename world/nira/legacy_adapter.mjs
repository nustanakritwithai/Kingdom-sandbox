/** R0 compatibility projection only. Does not mutate Kingdom-sandbox world or enable NPC simulation. */
export function buildKingdomR0Projection(pack,{legacyWidth=1000,legacyHeight=640}={}){
  const playable=new Set(['city','town','port']);
  const named=pack.locations.filter(l=>playable.has(l.type));
  const nodes=new Set(named.map(l=>l.id));
  const factionIds=new Set(pack.factions.map(f=>f.id));
  for(const l of named)if(l.owner_faction_id&&!factionIds.has(l.owner_faction_id))throw Error('unknown faction '+l.owner_faction_id);
  return {
    status:'PREVIEW_ONLY_NOT_APPLIED_TO_LIVE_ENGINE',
    source_dimensions:pack.manifest.coordinate_system,
    target_dimensions:{width:legacyWidth,height:legacyHeight},
    factions:pack.factions.map(f=>({externalId:f.id,name:f.name,color:f.color,homeRegionId:f.home_region_id})),
    settlements:named.map(l=>({externalId:l.id,name:l.name,legacyType:l.type==='city'?'town':l.type==='port'?'town':'village',x:l.map_x*legacyWidth/pack.manifest.coordinate_system.width,y:l.map_y*legacyHeight/pack.manifest.coordinate_system.height,factionExternalId:l.owner_faction_id,regionId:l.region_id})),
    routes:pack.routes.filter(r=>nodes.has(r.from_location_id)&&nodes.has(r.to_location_id)&&r.mode!=='portal').map(r=>({externalId:r.id,fromExternalId:r.from_location_id,toExternalId:r.to_location_id,mode:r.mode,estimatedQuality:Math.max(.2,1-r.risk)})),
    warnings:['Do not call createSettlement/createRoute automatically from this preview: legacy save IDs and route topology need a versioned scenario importer.','Legacy 1000×640 render differs from 1536×1536 canon source; image-space map integration needs a dedicated renderer.','No NPC AI, 24/7 server, ship transport, collision map or economic goods extension has been implemented.']
  };
}
