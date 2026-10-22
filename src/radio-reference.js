import {readFileSync} from 'node:fs';
// Exact server meanings recovered from the saved student SOP, Appendix A.
export const radioBook=JSON.parse(readFileSync(new URL('./radio_codes.json',import.meta.url),'utf8'));
export const radioEntries=new Map(radioBook.sections.flatMap(section=>section.entries).map(entry=>[entry.code.toLowerCase(),entry]));
const small=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const tens={twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
export function normalizeRadioCodes(text){
 return text.replace(/[–—−]/g,'-').replace(/\b10[.,]\s*99\b/g,'10-99').replace(/\bten[ -]+nine[ -]+nine\b/g,'10-99').replace(/\b10[ -]+(\d{1,2})\b/g,(_,number)=>'10-'+Number(number)).replace(/\bten[ -]+((?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[ -]+(?:one|two|three|four|five|six|seven|eight|nine))?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/g,(_,words)=>{const parts=words.split(/[ -]+/);return '10-'+(tens[parts[0]]?tens[parts[0]]+(parts[1]?small.indexOf(parts[1]):0):small.indexOf(parts[0]));});
}
export function codeCommand(command){
 const query=/^(?:what does |what is |what's |meaning of |define )(10-\d{1,2}|signal \d{1,3}|code (?:zero|\d+|blue|red)|11-44|51-50|priority [123])(?: mean)?$/.exec(command);
 if(query)return radioEntries.has(query[1])||/^signal (41|42)$/.test(query[1])?{action:'code_reference',code:query[1]}:{action:'unrecognized'};
 const code=/^(?:(?:i am|i'm|mark me|show me) )?(10-\d{1,2})$/.exec(command)?.[1];if(!code)return null;
 const statuses={'10-6':'busy','10-7':'unavailable','10-8':'available','10-23':'on_scene','10-97':'en_route'};
 if(statuses[code])return {action:'set_status',status:statuses[code]};
 if(code==='10-73')return {action:'status'};
 if(code==='10-2')return {action:'radio_check'};
 if(code==='10-4')return {action:'acknowledge'};
 if(code==='10-9')return {action:'repeat'};
 return radioEntries.has(code)?{action:'code_reference',code}:{action:'unrecognized'};
}
export function codeReply(code){
 if(/^signal (41|42)$/.test(code))return 'Signals forty one and forty two are retired in the CAD radio reference. Use plain language.';
 const entry=radioEntries.get(code);if(!entry)return 'That code is not in the saved CAD radio reference. Use plain language.';
 const suffix=code==='10-99'?' No distress alert has been issued. Use the CAD emergency control to request help.':/^10-(41|42|98)$/.test(code)?' This reference reply has not changed your duty, shift or call assignment.':'';
 return `In the CAD roleplay reference, ${entry.code} means ${entry.meaning}.${suffix}`;
}
