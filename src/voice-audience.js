export function audienceStatus(route,members){
 const listeners=[...(members?.values()||[])].filter(member=>!member.user?.bot),allowed=new Set((route?.authorized_listener_ids||[]).map(String));
 const eligible=listeners.filter(member=>allowed.has(String(member.id))).length;
 return {connected_listeners:listeners.length,eligible_listeners:eligible,blocked_listeners:listeners.length-eligible,playback_ready:listeners.length>0&&eligible===listeners.length};
}
