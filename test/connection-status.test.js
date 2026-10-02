import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {ConnectionStatus} from '../src/connection-status.js';
import {createAPI} from '../src/index.js';
const connection=(resolve)=>({client:{connectionState:{status:'connected'},resourceResolve:resolve}});
test('heartbeat is read-only, deduplicated and transport disconnection is immediate',async()=>{
 let calls=0,finish;const c=connection(input=>{assert.deepEqual(input,{uri:'file:///',followSymlinks:false});calls++;return new Promise(r=>finish=r);});
 const monitor=new ConnectionStatus();monitor.connected(c,'file:///');assert.equal(monitor.snapshot().state,'connected');monitor.snapshot();await delay(1);assert.equal(calls,1);finish({});await delay(1);monitor.snapshot();assert.equal(calls,1);
 c.client.connectionState.status='closed';assert.equal(monitor.snapshot().state,'disconnected');
});
test('a hung heartbeat cannot block status queries, and an old reply cannot revive a replacement connection',async()=>{
 let now=0,finish;const monitor=new ConnectionStatus({timeoutMs:20,intervalMs:30,now:()=>now});monitor.connected(connection(()=>new Promise(r=>finish=r)),'file:///');
 const start=performance.now();assert.equal(monitor.snapshot().state,'connected');assert.ok(performance.now()-start<15);await delay(35);assert.equal(monitor.snapshot().state,'disconnected');
 monitor.connecting();finish({});await delay(1);assert.equal(monitor.snapshot().state,'connecting');
 monitor.connected(connection(async()=>({})),'file:///');monitor.snapshot();await delay(1);assert.equal(monitor.snapshot().state,'connected');monitor.disconnected();assert.equal(monitor.snapshot().state,'disconnected');
});
test('status API bypasses a stuck directory request and does not discover or connect hosts',async()=>{
 let calls=0;const api=createAPI({snapshot:()=>({servers:[{id:'a'}]}),listRemoteDirectory:()=>new Promise(()=>{}),connectionStatuses:()=>{calls++;return {servers:[{id:'a',state:'connecting'}],workspaces:[]};}});
 void api.perform({action:'list',id:'a'});await delay(1);assert.deepEqual(api.status(),{ok:true,servers:[{id:'a',state:'connecting'}],workspaces:[]});assert.equal(calls,1);
});
