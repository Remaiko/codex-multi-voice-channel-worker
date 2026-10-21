/** A timed-out handshake must not remain cached forever. Never destroy its replacement. */
export async function ensureConnectionReady({connections,key,state,wait,readyStatus='ready'}){
 try{await wait();return state;}
 catch(error){
  if(connections.get(key)===state){
   if(state.connection.state.status===readyStatus)return state;
   connections.delete(key);try{state.connection.destroy();}catch{}
  }
  throw error;
 }
}

