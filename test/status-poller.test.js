import test from 'node:test';
import assert from 'node:assert/strict';
import {pollConnectionStatus} from '../src/status-poller.js';
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const answer=state=>({ok:true,json:async()=>({ok:true,servers:[{id:'a',state}],workspaces:[]})});
function fixture(t,fetch,visibility='visible'){
 t.mock.timers.enable({apis:['setTimeout']});
 const document=Object.assign(new EventTarget(),{visibilityState:visibility}),window=new EventTarget(),values=[],errors=[];
 const stop=pollConnectionStatus({document,window,fetch,onData:data=>values.push(data.servers[0].state),onError:e=>errors.push(e.message)});
 t.after(stop);return {document,window,values,errors,stop};
}
test('polling continues at five-second intervals and rejects cached responses',async t=>{
 let state='connected',calls=0;
 const f=fixture(t,async(_,options)=>{calls++;assert.equal(options.cache,'no-store');return answer(state);});
 await flush();assert.deepEqual(f.values,['connected']);state='disconnected';t.mock.timers.tick(5000);await flush();assert.deepEqual(f.values,['connected','disconnected']);assert.equal(calls,2);
});
test('a fetch that ignores cancellation times out, retries, and cannot replace new status with a late response',async t=>{
 let finish,calls=0;
 const f=fixture(t,()=>{calls++;return calls===1?new Promise(resolve=>finish=resolve):Promise.resolve(answer('disconnected'));});
 await flush();t.mock.timers.tick(4000);await flush();assert.equal(f.errors.length,1);t.mock.timers.tick(5000);await flush();assert.deepEqual(f.values,['disconnected']);
 finish(answer('connected'));await flush();assert.deepEqual(f.values,['disconnected']);
});
test('focus and window restoration refresh immediately without accepting an older in-flight result',async t=>{
 let finish,calls=0;const f=fixture(t,()=>{calls++;return calls===1?new Promise(resolve=>finish=resolve):Promise.resolve(answer('connected'));});
 await flush();f.window.dispatchEvent(new Event('focus'));await flush();assert.deepEqual(f.values,['connected']);finish(answer('disconnected'));await flush();assert.deepEqual(f.values,['connected']);
 f.window.dispatchEvent(new Event('pageshow'));await flush();assert.equal(calls,3);
});
test('mounting while hidden resumes both on visibilitychange and when only focus is delivered',async t=>{
 let calls=0;const f=fixture(t,async()=>{calls++;return answer('connected');},'hidden');await flush();t.mock.timers.tick(15000);await flush();assert.equal(calls,0);
 f.document.visibilityState='visible';f.window.dispatchEvent(new Event('focus'));await flush();assert.equal(calls,1);
 f.document.visibilityState='hidden';f.document.dispatchEvent(new Event('visibilitychange'));await flush();t.mock.timers.tick(5000);await flush();assert.equal(calls,1);
 f.document.visibilityState='visible';f.document.dispatchEvent(new Event('visibilitychange'));await flush();assert.equal(calls,2);
});
test('disposal cancels retries, event listeners and stale callbacks',async t=>{
 let finish;const f=fixture(t,()=>new Promise(resolve=>finish=resolve));await flush();f.stop();finish(answer('connected'));await flush();t.mock.timers.tick(20000);f.window.dispatchEvent(new Event('focus'));await flush();assert.deepEqual(f.values,[]);assert.deepEqual(f.errors,[]);
});
