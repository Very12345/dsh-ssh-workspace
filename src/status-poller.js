/** Recover polling after timeout, focus changes and suspension without replaying stale data. */
export function pollConnectionStatus({onData,onError,document:doc=globalThis.document,window:win=globalThis.window,fetch:request=globalThis.fetch,intervalMs=5000,timeoutMs=4000}) {
 let stopped=false,generation=0,timer,active;
 const cancel=()=>{generation++;clearTimeout(timer);if(active){clearTimeout(active.timeout);active.reject(new Error('Connection status request superseded'));active.controller.abort();active=null;}};
 const refresh=()=>{
  if(stopped)return;
  cancel();
  if(doc.visibilityState==='hidden'){timer=setTimeout(refresh,intervalMs);return;}
  const token=generation,controller=new AbortController();let timeout,reject;
  const expired=new Promise((_,fail)=>{reject=fail;timeout=setTimeout(()=>{controller.abort();fail(new Error('Connection status request timed out'));},timeoutMs);});
  active={controller,timeout,reject};
  const response=Promise.resolve().then(async()=>{
   controller.signal.throwIfAborted();
   const res=await request('/plugins/ssh-workspace/status',{signal:controller.signal,cache:'no-store'});
   const data=await res.json();if(!res.ok||!data.ok)throw new Error('Connection status unavailable');return data;
  });
  void Promise.race([response,expired]).then(data=>{if(!stopped&&token===generation)onData(data);},error=>{if(!stopped&&token===generation)onError(error);}).finally(()=>{
   clearTimeout(timeout);
   if(!stopped&&token===generation){active=null;timer=setTimeout(refresh,intervalMs);}
  });
 };
 doc.addEventListener('visibilitychange',refresh);win.addEventListener('focus',refresh);win.addEventListener('pageshow',refresh);
 refresh();
 return()=>{stopped=true;cancel();doc.removeEventListener('visibilitychange',refresh);win.removeEventListener('focus',refresh);win.removeEventListener('pageshow',refresh);};
}
