import test from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import {createScope} from '@deepseek-ai/dsh-scope';
import {SubprocessExecutableNotFoundError} from '@deepseek-ai/dsh-subprocess';
import {ActionType} from '@microsoft/agent-host-protocol';
import Subprocess, {buildRemoteInteractiveCommand} from '../src/provider/subprocess.js';

test('native agent scopes select remote terminal facts and executable lookup without changing local sessions', async t => {
  const root = new Context(), calls = [], scopes = [];
  const route = {kind:'remote',aliasPath:'/alias'};
  let status = 0, failure, removed = false;
  root.provide('localSubprocess', {
    terminalEnvironment: async signal => {calls.push(['localEnv',signal]); return {platform:'windows',defaultShell:'cmd.exe'};},
    resolveExecutable: async (...args) => {calls.push(['localLookup',...args]); return 'C:\\Windows\\System32\\cmd.exe';}
  });
  root.provide('remoteSshManager', {
    routeShell(cwd,id) {assert.equal(cwd,id==='remote'?'/alias':'/local'); if(removed && id==='remote') throw new Error('workspace removed'); return id==='remote'?route:{kind:'local'};},
    async workspaceShell(selected,dialect) {
      assert.equal(selected,route);assert.equal(dialect,'bash');
      return {resolve: spec => spec, run: async spec => {
        calls.push(['remoteLookup',spec]);
        if (failure) throw failure;
        return {exitCode:status,signal:null,stdout:{text:status===0?'__DSH_EXECUTABLE__/bin/bash\n':''}};
      }};
    }
  });
  await root.plugin(Subprocess);
  const scoped = id => {
    const agent = {session:{header:{id,cwd:id==='remote'?'/alias':'/local'}}};
    const scope = createScope(root,agent);scopes.push(scope);
    if (id==='remote') {
      const nested=createScope(root,{}, {parent:agent});scopes.push(nested);
      return nested.ctx.get('subprocess');
    }
    return scope.ctx.get('subprocess');
  };
  const remote=scoped('remote'), local=scoped('local');
  t.after(async()=>{await root.fiber.dispose();for(const scope of scopes.reverse())await scope.dispose();});
  assert.deepEqual(await remote.terminalEnvironment(),{platform:'posix',defaultShell:'/bin/bash'});
  assert.deepEqual(await local.terminalEnvironment(),{platform:'windows',defaultShell:'cmd.exe'});
  assert.equal(await remote.resolveExecutable('bash',{PATH:'/bin',EMPTY:undefined}),'/bin/bash');
  const spec=calls.find(c=>c[0]==='remoteLookup')[1];
  assert.equal(spec.workdir,'/alias');assert.match(spec.command,/'-u' 'EMPTY'/);
  assert.match(spec.command,/'PATH=\/bin'/);
  assert.equal(await local.resolveExecutable('cmd.exe'),'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(await root.subprocess.terminalEnvironment(),{platform:'windows',defaultShell:'cmd.exe'});
  status=127;
  await assert.rejects(remote.resolveExecutable('missing'),SubprocessExecutableNotFoundError);
  await assert.rejects(remote.resolveExecutable('C:\\Windows\\cmd.exe'),SubprocessExecutableNotFoundError);
  await assert.rejects(remote.resolveExecutable('./bash'),SubprocessExecutableNotFoundError);
  failure=new Error('SSH disconnected');
  await assert.rejects(remote.resolveExecutable('bash'),error=>error===failure);
  const signal=AbortSignal.abort(new Error('cancelled'));
  const count=calls.length;
  await assert.rejects(remote.terminalEnvironment(signal),/cancelled/);
  await assert.rejects(remote.resolveExecutable('bash',undefined,signal),/cancelled/);
  assert.equal(calls.length,count);
  removed=true;
  await assert.rejects(remote.terminalEnvironment(),/workspace removed/);
  assert.deepEqual(await local.terminalEnvironment(),{platform:'windows',defaultShell:'cmd.exe'});
});

test('remote PTY supports native terminal input, resize, conservative activity, cancellation and cleanup', async t => {
  const root=new Context(),requests=[],actions=[];
  let next, closed=false;
  const subscription={next:()=>new Promise(resolve=>{next=resolve;}),close:async()=>{closed=true;}};
  const client={
    request:async(method,args)=>{requests.push([method,args]);if(method==='disposeTerminal')next?.({done:true});},
    subscribe:async()=>({subscription}),
    dispatch:(channel,action)=>actions.push({channel,...action})
  };
  const route={kind:'remote',mapper:{toRemotePath:()=>'/remote/project'}};
  root.provide('localSubprocess',{spawnTerminal:async()=>{throw new Error('must not spawn locally');}});
  root.provide('remoteSshManager',{route:()=>route,workspaceContext:async()=>({remote:{getClient:async()=>client,clientId:'test'}})});
  await root.plugin(Subprocess);t.after(()=>root.fiber.dispose());
  const spec={argv:['/bin/bash','-i'],cwd:'/alias',env:{DSH_SESSION_ID:'test'},cols:80,rows:24,terminalType:'xterm-256color',shellActivity:true,graceMs:500};
  await assert.rejects(root.subprocess.spawnTerminal({...spec,signal:AbortSignal.abort(new Error('cancelled'))}),/cancelled/);
  assert.equal(requests.length,0);
  const handle=await root.subprocess.spawnTerminal(spec);
  assert.equal(requests[0][1].cwd,'file:///remote/project');
  assert.deepEqual(await handle.inspectActivity(),{state:'unknown',revision:0});
  await handle.write('pwd\r');await handle.resize(120,35);
  assert.deepEqual(actions.at(-1),{channel:actions[0].channel,type:ActionType.TerminalResized,cols:120,rows:35});
  assert.deepEqual(await handle.inspectActivity(),{state:'unknown',revision:2});
  await assert.rejects(handle.resize(0,24),/positive integers/);
  assert.equal(await handle.inspectForeground(),undefined);
  await handle.signalForeground('SIGINT');assert.equal(actions.at(-1).data,'\x03');
  await handle.terminate();await handle.terminate();await handle.done.catch(()=>{});
  assert.equal(closed,true);assert.ok(requests.some(([method])=>method==='disposeTerminal'));
  assert.match(buildRemoteInteractiveCommand(['/bin/bash'],{UNSET:undefined}),/env '-u' 'UNSET'/);
});
