import test from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import {createScope,bindScopeParent} from '@deepseek-ai/dsh-scope';
import {ToolRuntime,defineTool} from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import * as policy from '../src/policy.js';
const native=name=>defineTool({name,description:'Test '+name,parameters:{},output:{schema:{type:'string'},render:(_a,v)=>[{type:'text',text:v}]},execute:async()=>name});
test('real scoped DSH tools select remote Bash across modes, keep PTC and local tools/permissions',async t=>{
 const root=new Context(),agents=new Map(),scopes=[];let preset='standard',received,effectiveMode='danger-full-access',approvalOutcome='allowed-once',approvals=0,executions=0;
 root.provide('ptcRuntime',{language:'python'});root.provide('agents',{get:id=>agents.get(id),list:()=>[]});root.provide('agentPresets',{composedPreset:()=>preset});
 const sessionPolicy={defaultMode:'workspace-write',resolve:()=>({mode:effectiveMode,workspaceRoot:'/alias'})};root.provide('sandboxPolicy',sessionPolicy);
 root.provide('approval',{request:async()=>{approvals++;return approvalOutcome;}});
 root.provide('sessionProjections',{register:()=>()=>{},stateOf:()=>undefined});root.provide('subprocess',{});root.provide('shellEnv',{collect:()=>({})});
 root.provide('shell',{sandboxMode:'workspace-write',resolve:r=>({...r,workdir:r.workdir??'/alias',timeoutMs:r.timeoutMs??60000,stdoutMaxBytes:10000})});
 root.provide('remoteSshManager',{wasRemoteAlias:cwd=>cwd==='/alias',bindSession:()=>({kind:'remote',workspace:{id:'w',remotePath:'/remote/project'}}),unbindSession(){},workspace:()=>({kind:'remote',workspace:{id:'w',remotePath:'/remote/project'}}),async workspaceShell(){return{async execute(spec){received=spec;executions++;const denied=spec.sandboxPolicy.mode==='read-only'&&spec.command==='write denied';return {result:async()=>({exitCode:denied?1:0,signal:null,timedOut:false,aborted:false,timeoutMs:spec.timeoutMs,stdout:{text:'remote_ok',truncated:false},stderr:{text:'',truncated:false},sandbox:{mode:spec.sandboxPolicy.mode,enforcement:'full',denied}})};}}}});
 await root.plugin(SystemPrompt);await root.plugin(ToolRuntime);await root.plugin(policy);t.after(async()=>{await root.fiber.dispose();for(const s of scopes.reverse())await s.dispose();});
 for(preset of ['standard','ptc','minimal','cordis']){
  const baseKey={},agent={id:preset,session:{header:{id:preset,cwd:'/alias'},append(){}}},base=createScope(root,baseKey),own=createScope(root,agent);scopes.push(base,own);bindScopeParent(agent,baseKey);agent.ctx=own.ctx;agents.set(agent.id,agent);
  base.ctx.get('tools').register(native('pwsh'));base.ctx.get('tools').register(native('read_file'));if(preset==='ptc')base.ctx.get('tools').presentAs('ptc');
  await root.sshWorkspaceRouting.bind(agent);assert.equal(root.tools.get('pwsh',agent),undefined);assert.ok(root.tools.get('bash',agent));assert.ok(root.tools.get('read_file',agent));assert.equal(root.sandboxPolicy,sessionPolicy);
  if(preset==='ptc'){assert.deepEqual(root.tools.wireSchemas(agent).schemas.map(s=>s.name),['run_code']);assert.ok(root.tools.sdkSchemas(agent).some(s=>s.name==='bash'));}
  if(preset==='standard'){const result=await root.tools.get('bash',agent).execute({command:'printf remote_ok',description:'Verify remote routing'},{agent,cwd:'/alias',signal:new AbortController().signal,callId:'test'});assert.match(JSON.stringify(result),/remote_ok/);assert.equal(received.sandboxPolicy.mode,'danger-full-access');
   const bash=root.tools.get('bash',agent),exec={agent,cwd:'/alias',signal:new AbortController().signal,callId:'permission-test'};
   effectiveMode='workspace-write';await bash.execute({command:'printf mode',description:'Retain workspace permission'},exec);assert.equal(received.sandboxPolicy.mode,'workspace-write');assert.equal(approvals,0);
   effectiveMode='read-only';const denied=await bash.execute({command:'write denied',description:'Test a denied write'},exec);assert.equal(denied.sandbox.denied,true);assert.match(JSON.stringify(bash.output.render({},denied)),/escalation available/);
   await bash.execute({command:'write denied',description:'Approved retry',sandbox_permissions:'workspace-write',justification:'Allow this exact test write'},exec);assert.equal(approvals,1);assert.equal(received.sandboxPolicy.mode,'workspace-write');assert.equal(sessionPolicy.resolve().mode,'read-only');
   approvalOutcome='rejected';const before=executions;await assert.rejects(bash.execute({command:'write denied',description:'Rejected retry',sandbox_permissions:'workspace-write',justification:'Test rejection'},exec),/rejected/);assert.equal(executions,before);effectiveMode='danger-full-access';
  }
  await root.sshWorkspaceRouting.dispose(agent);assert.ok(root.tools.get('pwsh',agent));
 }
 const local={id:'local',session:{header:{cwd:'/local'}}};await root.sshWorkspaceRouting.bind(local);assert.equal(root.sandboxPolicy,sessionPolicy);
});
