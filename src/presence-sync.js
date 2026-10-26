/** Canonical room membership, independent of gateway iteration order. */
export function presenceKey(members){
 return JSON.stringify([...new Set(members.map(m=>JSON.stringify([String(m.guild_id),String(m.channel_id),String(m.discord_id)])))].sort());
}
/** Empty idle rooms need no repeated writes. Occupied rooms retain their 30s heartbeat. */
export function createPresencePublisher({now=Date.now,heartbeatMs=20_000}={}){
 let acknowledged=null,acknowledgedAt=-Infinity,publishedSnapshots=0,routeOnlyRefreshes=0;
 return {stats(){return {publishedSnapshots,routeOnlyRefreshes};},request(members){
  const key=presenceKey(members),startedAt=now(),publish=key!==acknowledged||(members.length>0&&startedAt-acknowledgedAt>=heartbeatMs);
  if(!publish)routeOnlyRefreshes++;let accepted=false;
  return {payload:publish?{presence:members.map(m=>({...m}))}:{},acknowledge(){if(publish&&!accepted){accepted=true;publishedSnapshots++;acknowledged=key;acknowledgedAt=startedAt;}}};
 }};
}
/** One refresh at a time, with a follow-up for room changes observed during a request. */
export function createPresenceRouteSync({capture,refresh,after=()=>{},active=()=>true}){
 let flight=null;
 return function sync(){
  if(!active())return Promise.resolve();
  if(flight)return flight;
  flight=Promise.resolve().then(async()=>{
   do{const snapshot=capture(),key=presenceKey(snapshot);await refresh(snapshot);if(!active()||key===presenceKey(capture()))break;}while(true);
   if(active())await after();
  }).finally(()=>{flight=null;});
  return flight;
 };
}
