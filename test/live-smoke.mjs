import {Context} from '@deepseek-ai/cordis';
import {createScope,bindScopeParent} from '@deepseek-ai/dsh-scope';
import {ToolRuntime,defineTool} from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Manager from '../src/provider/manager.js';
import Fs from '../src/provider/fs.js';
import Subprocess from '../src/provider/subprocess.js';
import * as SearchHook from '../src/provider/search.js';
import * as Policy from '../src/policy.js';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {sshExecutable} from '../src/hosts.js';
import {initializeHost} from '../src/initialize.js';
const target=process.env.DSH_SSH_TEST_TARGET;if(!target||target.startsWith('-')||/[\s\0]/.test(target))throw new Error('Set DSH_SSH_TEST_TARGET to an authorized SSH config alias.');
const exe=sshExecutable(),args=['-o','StrictHostKeyChecking=yes','-o','BatchMode=yes',target];
const remoteCodeCommand=process.env.DSH_SSH_CODE_COMMAND||await initializeHost({sshTarget:target,sshExecutable:exe,sshArgs:args.slice(0,-1)});
const ssh=cmd=>execFileSync(exe,[...args,cmd],{encoding:'utf8',windowsHide:true}).trim();
const dir=ssh('mktemp -d /tmp/dsh-ssh-workspace-sdk-XXXXXXXX');if(!/^\/tmp\/dsh-ssh-workspace-sdk-[a-zA-Z0-9]+$/.test(dir))throw new Error('unsafe path');
const ctx=new Context(),scopes=[];let preset='standard',route;const permission=process.env.DSH_SSH_TEST_PERMISSION||'workspace-write';const agents=new Map();
try{
 ctx.provide('ptcRuntime',{language:'python'});ctx.provide('agents',{get:id=>agents.get(id),list:()=>[]});ctx.provide('agentPresets',{composedPreset:()=>preset});ctx.provide('shellEnv',{collect:()=>({})});ctx.provide('sessionProjections',{register:()=>()=>{},stateOf:()=>undefined});ctx.provide('sandboxPolicy',{defaultMode:'workspace-write',resolve:()=>({mode:permission,workspaceRoot:route.aliasPath})});
 ctx.provide('shell',{sandboxMode:'workspace-write',resolve:r=>({...r,workdir:r.workdir??route.aliasPath,timeoutMs:r.timeoutMs??15000,stdoutMaxBytes:10000})});ctx.provide('localFs',{});ctx.provide('localSubprocess',{});
 await ctx.plugin(SystemPrompt);await ctx.plugin(ToolRuntime);await ctx.plugin(Manager,{aliasRoot:resolve('.tmp/live-sdk-'+Date.now()+'/projects'),startupTimeoutMs:90000});
 await ctx.remoteSshManager.addServer({id:'test',label:'Test host',sshTarget:target,sshArgs:args.slice(0,-1),sshExecutable:exe,remoteCodeCommand});route=await ctx.remoteSshManager.addWorkspace('test',dir);
 await ctx.plugin(Fs);await ctx.plugin(Subprocess);await ctx.plugin(Policy);
 const file=await ctx.fs.resolve('integration.txt',{cwd:route.aliasPath});await ctx.fs.writeText(file,'remote_search_ok\n',undefined,undefined,{mode:'danger-full-access'});
 ctx.provide('loader',{internal:{loadCache:new Map()}});await ctx.plugin(SearchHook);
 for(preset of ['standard','ptc','minimal','cordis']){
  const baseKey={},agent={id:preset,session:{header:{id:preset,cwd:route.aliasPath},append(){}}},base=createScope(ctx,baseKey),own=createScope(ctx,agent);scopes.push(base,own);bindScopeParent(agent,baseKey);agent.ctx=own.ctx;agents.set(agent.id,agent);
  base.ctx.get('tools').register(defineTool({name:'pwsh',description:'Original local tool',parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute:async()=>''}));if(preset==='ptc')base.ctx.get('tools').presentAs('ptc');
  await ctx.sshWorkspaceRouting.bind(agent);const bash=ctx.tools.get('bash',agent),exec={agent,cwd:route.aliasPath,signal:new AbortController().signal,callId:'test'};
  if(preset==='standard'){
   const subprocess=agent.ctx.get('subprocess');
   assert.deepEqual(await subprocess.terminalEnvironment(),{platform:'posix',defaultShell:'/bin/bash'});
   const shellPath=await subprocess.resolveExecutable('bash');assert.match(shellPath,/^\//);
   const {SubprocessExecutableNotFoundError}=await import('@deepseek-ai/dsh-subprocess');
   await assert.rejects(subprocess.resolveExecutable('dsh_missing_executable_'+Date.now()),SubprocessExecutableNotFoundError);
   const terminal=await subprocess.spawnTerminal({argv:[shellPath,'-i'],cwd:route.aliasPath,env:{DSH_SESSION_ID:agent.id},cols:80,rows:24,terminalType:'xterm-256color',shellActivity:true,graceMs:500});
   let output='';terminal.output.on('data',chunk=>{output+=chunk.toString();});
   const waitFor=async pattern=>{const deadline=Date.now()+20000;while(!pattern.test(output)){if(Date.now()>deadline)throw new Error('remote PTY output timeout');await new Promise(r=>setTimeout(r,50));}};
   try{
    await terminal.write("printf '__DSH_%s__\\n' PTY_READY\r");await waitFor(/__DSH_PTY_READY__/);
    await terminal.resize(110,33);
    await terminal.write("stty size; printf '__DSH_%s__\\n' PTY_RESIZED\r");await waitFor(/__DSH_PTY_RESIZED__/);assert.match(output,/33 110/);
    assert.equal((await terminal.inspectActivity()).state,'unknown');
    await terminal.write("pwd; printf '__DSH_%s__\\n' PTY_CWD\r");await waitFor(/__DSH_PTY_CWD__/);assert.ok(output.includes(dir));
    console.log('native terminal environment, remote shell lookup, PTY input/output/cwd/resize/activity PASS');
   }finally{await terminal.terminate();await terminal.done.catch(()=>{});}
  }
  const result=await bash.execute({command:'printf remote_sdk_ok',description:'Verify SSH tool routing'},exec);assert.match(JSON.stringify(result),/remote_sdk_ok/);console.log(preset+' real remote tool execution PASS');
  if(preset==='minimal'){await bash.execute({command:'export DSH_TEST_PERSIST=retained',description:'Verify persistent shell'},exec);const value=await bash.execute({command:'printf "$DSH_TEST_PERSIST"',description:'Read persistent shell state'},exec);assert.match(JSON.stringify(value),/retained/);console.log('minimal persistent state PASS');}
  await ctx.sshWorkspaceRouting.dispose(agent);
 }
 const host=await ctx.remoteSshManager.hostContext(route.server);host.remote.tunnel.kill();await new Promise(r=>setTimeout(r,300));await host.remote.getConnection();console.log('owned tunnel disconnect/reconnect PASS');
 const search=await import('@deepseek-ai/dsh-tool-fs-search');
 const source=await ctx.subprocess.spawn({argv:[await search.resolveRgPath(),'--no-config','--files','.'],cwd:route.aliasPath,stdio:{stdin:'ignore',stdout:{maxBytes:10000},stderr:{maxBytes:10000}},graceMs:500});const outcome=await source.done;assert.equal(outcome.exitCode,0);assert.match(source.collected.stdout.readFrom(0).text,/integration.txt/);console.log('native packaged ripgrep via remote subprocess PASS');
}finally{await ctx.fiber.dispose();for(const scope of scopes.reverse())await scope.dispose();ssh("rm -rf -- '"+dir+"'");console.log('owned temporary remote directory removed');}
