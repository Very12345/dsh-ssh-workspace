// Full-runtime regression. Set DSH_TEST_EXECUTABLE and DSH_TEST_CLI to a
// compatible installed host. Optional DSH_TEST_EXTRA_BUNDLE(_DIR) adds a
// provider such as Our Free Model. No live credentials or prompts are used.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const executable=process.env.DSH_TEST_EXECUTABLE||process.execPath,cli=process.env.DSH_TEST_CLI;
if(!cli)throw Error('Set DSH_TEST_CLI to an installed DSH lib/bin.js.');
const source=fileURLToPath(new URL('../',import.meta.url)),home=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-ssh-hmr-'));
const profile=path.join(home,'profiles/web'),proof=path.join(home,'proof.mjs'),guard=path.join(home,'guard.mjs');
const links=[];let child,output='';
try{
 await fs.mkdir(path.join(profile,'node_modules/@very12345'),{recursive:true});
 const link=path.join(profile,'node_modules/@very12345/dsh-ssh-workspace');
 await fs.symlink(source,link,process.platform==='win32'?'junction':'dir');links.push(link);
 const bundles=['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','@very12345/dsh-ssh-workspace'];
 const extra=process.env.DSH_TEST_EXTRA_BUNDLE,extraDir=process.env.DSH_TEST_EXTRA_BUNDLE_DIR;
 if(extra){assert.ok(extraDir);const target=path.join(profile,'node_modules',extra);await fs.mkdir(path.dirname(target),{recursive:true});await fs.symlink(path.resolve(extraDir),target,process.platform==='win32'?'junction':'dir');links.push(target);bundles.push(extra);}
 await fs.writeFile(path.join(profile,'package.json'),JSON.stringify({name:'dsh-ssh-hmr-fixture',private:true,dsh:{profile:{bundles}},dependencies:{}}));
 await fs.writeFile(path.join(profile,'cordis.yml'),'[]\n');
 await fs.writeFile(proof,"export const inject=['webServer','loader'];export function apply(ctx){ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/fixture/state',handler:async(_req,res)=>{try{const rows=await ctx.loader.entries(),failures=[],pending=[],sessions=[],packages=[];for await(const entry of rows){const options=await entry.options,fiber=await entry.fiber,state=await fiber?.state,error=await fiber?._error;const row={id:options.id,name:options.name,state,error:error?.message};if(options.name==='dsh-our-free-model'||options.name==='@very12345/dsh-ssh-workspace/provider/manager')packages.push(row);if(error||state===3)failures.push(row);if(state===0&&!options.disabled)pending.push(row);if(options.name==='@deepseek-ai/dsh-api-session-controller')sessions.push(row);}res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({sessions,failures,pending,packages}));}catch(e){res.writeHead(500);res.end(e.message);}}}));}");
 await fs.writeFile(guard,"globalThis.fetch=async()=>{throw Error('HMR_FIXTURE_OUTBOUND_DISABLED')};");
 const patch=path.join(profile,'cordis.patch.yml');
 const configuration=model=>'- id: agent-default-model\n  config:\n    provider: deepseek-official\n    model: '+model+'\n- id: our-free-model\n  config:\n    distribution: managed\n- insert:\n    - id: hmr-fixture-proof\n      name: '+JSON.stringify(pathToFileURL(proof).href)+'\n';
 await fs.writeFile(patch,configuration('deepseek-flash'));
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/TOKEN|SECRET|PASSWORD|CREDENTIAL|API.?KEY|^DSH_|^WEBAGENT_|NODE_OPTIONS/i.test(key)));
 Object.assign(env,{ELECTRON_RUN_AS_NODE:'1',DSH_HOME:home,DSH_AGENTS_HOME:path.join(home,'agents'),NODE_OPTIONS:'--import='+pathToFileURL(guard).href,DO_NOT_TRACK:'1'});
 const prefix=process.env.DSH_TEST_EXPOSE_INTERNALS==='1'?['--expose-internals']:[];
 child=spawn(executable,[...prefix,cli,'--profile','web','--port','0','--no-open'],{env,cwd:home,windowsHide:true,stdio:['ignore','pipe','pipe']});
 const capture=data=>output=(output+String(data)).slice(-300000);child.stdout.on('data',capture);child.stderr.on('data',capture);
 let origin;const deadline=Date.now()+30000;
 while(Date.now()<deadline&&child.exitCode===null){
  for(const match of output.matchAll(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/g)){
   try{const response=await fetch(match[0]+'/fixture/state',{signal:AbortSignal.timeout(500)});if(response.ok){origin=match[0];break;}}catch{}
  }
  if(origin)break;await new Promise(resolve=>setTimeout(resolve,150));
 }
 assert.ok(origin,'Isolated host did not expose proof endpoint: '+output.slice(-2000));
 const ready=async()=>{
  const state=await(await fetch(origin+'/fixture/state',{signal:AbortSignal.timeout(3000)})).json();
  assert.ok(state.packages.some(row=>row.name==='@very12345/dsh-ssh-workspace/provider/manager'&&row.state===2));if(extra)assert.ok(state.packages.some(row=>row.name===extra&&row.state===2));assert.ok(state.sessions.length>0);assert.ok(state.sessions.every(row=>row.state===2));
  assert.deepEqual(state.failures,[]);assert.deepEqual(state.pending,[]);
 };
 await new Promise(resolve=>setTimeout(resolve,500));await ready();
 for(let round=0;round<4;round++){
  await fs.writeFile(patch,configuration(round%2?'deepseek-flash':'deepseek-v4-pro'));
  await new Promise(resolve=>setTimeout(resolve,3000));await ready();
 }
 console.log(JSON.stringify({realInstalledHost:true,extraBundle:extra||null,reloadRounds:4,sessionControllerActive:true,pendingServices:0,failedServices:0,modelRequests:0}));
}finally{
 if(child?.exitCode===null){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,4000))]);}
 // Remove owned junctions first, then only the verified temporary home.
 for(const link of links)await fs.unlink(link);
 assert.equal(path.dirname(home),path.resolve(os.tmpdir()));assert.ok(path.basename(home).startsWith('dsh-ssh-hmr-'));
 await fs.rm(home,{recursive:true,force:true,maxRetries:4,retryDelay:100});
}
