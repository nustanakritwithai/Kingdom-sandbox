/** R0 route-graph calculation. Schematic edges only; not pixel collision/pathfinding. */
export function findShortestPath(pack,from,to,{allowPortals=false}={}){
  const locations = new Set(pack.locations.map(l=>l.id));
  if(!locations.has(from)||!locations.has(to))return null;
  if(from===to)return {nodes:[from],routes:[],cost:0,units:0};
  const nodes=new Map([...locations].map(id=>[id,{cost:Infinity,prev:null,route:null}]));
  nodes.get(from).cost=0;
  const seen=new Set();
  const graph=new Map([...locations].map(id=>[id,[]]));
  for(const r of pack.routes){
    if(r.mode==='portal'&&!allowPortals)continue;
    if(!graph.has(r.from_location_id)||!graph.has(r.to_location_id))continue;
    graph.get(r.from_location_id).push({next:r.to_location_id,route:r});
    if(r.bidirectional)graph.get(r.to_location_id).push({next:r.from_location_id,route:r});
  }
  while(seen.size<nodes.size){
    let curr=null,best=Infinity;
    for(const [id,v] of nodes)if(!seen.has(id)&&v.cost<best){best=v.cost;curr=id;}
    if(curr===null||curr===to)break;
    seen.add(curr);
    for(const {next,route} of graph.get(curr)){
      const c=nodes.get(curr).cost+route.distance_units*(1+route.risk*0.5);
      if(c<nodes.get(next).cost){Object.assign(nodes.get(next),{cost:c,prev:curr,route});}
    }
  }
  if(!Number.isFinite(nodes.get(to).cost))return null;
  let id=to;const path=[to],routes=[];
  while(id!==from){const step=nodes.get(id);if(!step.prev)return null;routes.push(step.route);id=step.prev;path.push(id);}
  path.reverse();routes.reverse();
  return {nodes:path,routes,cost:nodes.get(to).cost,units:routes.reduce((n,r)=>n+r.distance_units,0)};
}
