// Observe an existing AHP connection; status reads never open an SSH connection.
export class ConnectionStatus {
 constructor({intervalMs=15000,timeoutMs=4000,now=Date.now}={}){this.intervalMs=intervalMs;this.timeoutMs=timeoutMs;this.now=now;this.state='connecting';this.updatedAt=now();this.lastProbe=-Infinity;this.connection=null;this.pending=false;this.generation=0;}
 set(state){if(this.state!==state){this.state=state;this.updatedAt=this.now();}}
 connecting(){this.generation++;this.connection=null;this.pending=false;this.set('connecting');}
 connected(connection,uri){this.generation++;this.connection=connection;this.uri=uri;this.pending=false;this.lastProbe=-Infinity;this.set('connected');}
 disconnected(){this.generation++;this.connection=null;this.pending=false;this.set('disconnected');}
 snapshot(){
  const client=this.connection?.client;
  if(client&&client.connectionState.status!=='connected')this.set('disconnected');
  else if(client&&!this.pending&&this.now()-this.lastProbe>=this.intervalMs)this.probe(client);
  return {state:this.state,updatedAt:this.updatedAt};
 }
 probe(client){
  this.pending=true;this.lastProbe=this.now();const generation=this.generation;
  let timeout;
  const expired=new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Heartbeat timed out')),this.timeoutMs);timeout.unref?.();});
  const request=Promise.resolve().then(()=>client.resourceResolve({uri:this.uri,followSymlinks:false}));
  void Promise.race([request,expired]).then(()=>{if(generation===this.generation)this.set(client.connectionState.status==='connected'?'connected':'disconnected');},()=>{if(generation===this.generation)this.set('disconnected');}).finally(()=>{clearTimeout(timeout);if(generation===this.generation)this.pending=false;});
 }
}
