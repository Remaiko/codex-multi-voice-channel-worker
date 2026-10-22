// Structured radio queries: never treat spoken names or roads as executable code.
export function recordCommand(input){
 const text=String(input).trim().replace(/[.!?]+$/,'');
 let m=/^(?:run|check|look up)(?: the)? (?:name|person)\s+(.{2,80})$/i.exec(text);
 if(m)return {action:'run_name',query:m[1]};
 m=/^(?:run|check|look up)(?: the)? (?:plate|license plate|registration)\s+(.{2,80})$/i.exec(text);
 if(m)return {action:'run_plate',query:m[1]};
 m=/^(?:update|set|change) my location (?:to|as)\s+(.{2,100})$/i.exec(text)||/^(?:i am|i'm|show me|mark me) (?:on|at)\s+(.{2,100})$/i.exec(text);
 if(m){const digits={zero:'0',oh:'0',one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9'};return {action:'set_location',query:m[1].replace(/\b(postal|post code)\s+((?:(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)[ -]+){0,4}(?:zero|oh|one|two|three|four|five|six|seven|eight|nine))$/i,(_,label,words)=>label+' '+words.toLowerCase().split(/[ -]+/).map(w=>digits[w]).join(''))};}
 return null;
}
