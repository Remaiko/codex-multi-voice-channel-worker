export async function closeVoiceWorker({connections,bots,server}){
 try{server.close();}catch{}
 for(const state of connections.values()){try{state.player.stop(true);}catch{}try{state.connection.destroy();}catch{}}
 connections.clear();
 await Promise.allSettled(bots.map(bot=>Promise.resolve().then(()=>bot.client.destroy())));
}
