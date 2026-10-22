const defaults={new:'Units needed: {call_type}. Priority {priority}. {location}, postal {postal}. {details}. Call {call_id}.',update:'Call {call_id} update. {call_type}. {location}, postal {postal}. Updated information: {details}. Status {status}.',duress:'Officer duress. Priority assistance requested. {location}, postal {postal}. {details}. Call {call_id}.',amber:'AMBER alert. {call_type}. {location}, postal {postal}. {details}. Call {call_id}.'};
export function dispatchOpening(delivery){
 if(!['new','duress','amber'].includes(delivery.kind))return '';
 return String(delivery.templates?.prefix??'Units, stand by for tones.').replace(/[\x00-\x1f]/g,' ').trim().slice(0,100);
}
export function dispatchBody(delivery){
 const p=delivery.payload||{},t=delivery.templates||{},kind=Object.hasOwn(defaults,delivery.kind)?delivery.kind:'update';
 const values={call_id:delivery.call_id||delivery.event_id||'',call_type:p.call_type||'incident',priority:p.priority||'unassigned',location:p.location||'Location unreported',postal:p.postal||p.postal_code||'unknown',status:p.status||'unknown',details:p.narrative||p.details||'No further information recorded',agency:delivery.agency_code||''};
 const expand=s=>String(s).replace(/\{([a-z_]+)\}/gi,(_,key)=>values[key.toLowerCase()]||'').replace(/\s+([.,!?])/g,'$1').replace(/(?:\s*\.\s*){2,}/g,'. ').trim();
 let body=typeof p.radio_message==='string'&&p.radio_message.trim()?p.radio_message:expand(typeof t[kind]==='string'&&t[kind].trim()?t[kind]:defaults[kind]);
 const opening=dispatchOpening(delivery);if(opening&&body.toLowerCase().startsWith(opening.toLowerCase()))body=body.slice(opening.length).replace(/^[\s.,:;-]+/,'');
 body=[body,expand(t.suffix||'')].filter(Boolean).join('. ').replace(/[\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim();
 if(body.length>850){const head=body.slice(0,810);body=head.slice(0,head.lastIndexOf(' '))+'. Further information is in CAD.';}
 return body;
}