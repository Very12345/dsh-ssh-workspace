import test from 'node:test';
import assert from 'node:assert/strict';
import {openAgentHost,cachedAgentHostsCommand,VALIDATED_SERVER_COMMIT} from '../src/agent-host-startup.js';

function fixture({command='code',caches=['/cache/code-server'],rejectCaches=false,onlineError}={}){
 const calls=[],runtime={
  config:{remoteCodeCommand:command,sshExecutable:'ssh',sshArgs:['-o','BatchMode=yes'],sshTarget:'example.invalid',startupTimeoutMs:600000,protocolVersions:['0.9']},
  listEmbeddedAgentHosts:async()=>{calls.push('discover');return caches;},
  startEmbeddedAgentHost:async(path)=>{calls.push('cache:'+path);if(rejectCaches)throw Error('incompatible AHP');return 'cached-endpoint';},
  connectEndpoint:async url=>{calls.push('connect:'+url);return {url};},
  openTunnel:async(port,token)=>{calls.push('tunnel');return 'online-endpoint';},
  resetSshAttempt:()=>calls.push('reset')
 },helpers={
  runCaptured:async(_exe,_args,timeout)=>{calls.push('online:'+timeout);if(onlineError)throw onlineError;return {exitCode:0,stdout:'ws://127.0.0.1:1234?tkn=fixture-secret',stderr:''};},
  buildRemoteAgentHostCommand:()=>'',stripAnsi:x=>x,tailDiagnostic:x=>x,connectionDiagnostic:e=>e.message
 };
 return {runtime,helpers,calls};
}
test('cached compatible server serves folders while online DNS fails without any download attempt',async()=>{
 const f=fixture({onlineError:Error('Resolving timed out')});
 assert.deepEqual(await openAgentHost(f.runtime,f.helpers),{url:'cached-endpoint'});
 assert.deepEqual(f.calls,['discover','cache:/cache/code-server','connect:cached-endpoint']);
});
test('plugin-initialized CLI paths also prefer the compatible cache',async()=>{
 const f=fixture({command:'/home/test/.dsh-ssh-workspace/cli/code'});
 await openAgentHost(f.runtime,f.helpers);assert.equal(f.calls.some(x=>x.startsWith('online:')),false);
});
test('explicit custom CLI stays authoritative and is not replaced by a different cached server',async()=>{
 const f=fixture({command:'/custom/bin/code'});await openAgentHost(f.runtime,f.helpers);
 assert.deepEqual(f.calls,['online:45000','tunnel','connect:online-endpoint']);
});
test('incompatible cache is cleaned once, then the online path has a bounded timeout',async()=>{
 const f=fixture({rejectCaches:true});await openAgentHost(f.runtime,f.helpers);
 assert.equal(f.calls.filter(x=>x==='reset').length,1);assert.ok(f.calls.includes('online:45000'));
});
test('failed discovery/download reports the Agent Host layer and never leaks endpoint credentials',async()=>{
 const f=fixture({caches:[],onlineError:Error('failed to fetch ws://127.0.0.1:1?tkn=fixture-secret')});
 await assert.rejects(openAgentHost(f.runtime,f.helpers),e=>{
  assert.equal(e.code,'ssh_agent_host_unavailable');assert.match(e.message,/DNS/);assert.doesNotMatch(e.message,/fixture-secret/);return true;
 });
});
test('startup probes exactly the validated plugin-managed server before ordinary VS Code caches',()=>{
 const cmd=cachedAgentHostsCommand();assert.match(cmd,new RegExp(VALIDATED_SERVER_COMMIT));assert.match(cmd,/\.dsh-ssh-workspace\/cli\/servers\/Stable-/);
 assert.ok(cmd.indexOf('printf')<cmd.indexOf('.vscode-server'));assert.doesNotMatch(cmd,/curl|wget|without-connection-token/);
});
