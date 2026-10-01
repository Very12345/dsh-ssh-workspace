import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {Context} from '@deepseek-ai/cordis';import Manager from '../src/provider/manager.js';import * as Hooks from '../src/provider/search.js';
test('native DSH instruction loading stays inside remote project and preserves local discovery',async t=>{
 const root=await mkdtemp(join(tmpdir(),'dsh-instructions-')),ctx=new Context();t.after(async()=>{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});});await ctx.plugin(Manager,{aliasRoot:join(root,'projects')});const m=ctx.remoteSshManager;await m.addServer({id:'test',label:'Test',sshTarget:'example.invalid'});const route=await m.addWorkspace('test','/remote/project');ctx.provide('loader',{internal:{loadCache:new Map()}});await ctx.plugin(Hooks);
 // Import after installing the same load hook used before preset activation.
 const native=await import('@deepseek-ai/dsh-agent-instructions');const seen=[];const localRoot=join(root,'local-repository'),localCwd=join(localRoot,'child');
 const content=new Map([[join(route.aliasPath,'AGENTS.md'),'Remote project instructions'],[join(localRoot,'AGENTS.md'),'Local ancestor instructions']]);
 const fs={async resolve(path){seen.push(path);m.route(path);return {targetKey:path,displayPath:path};},async stat(target){if(content.has(target.targetKey))return {type:'file',size:100,version:'v1'};if(target.targetKey===join(localRoot,'.git'))return {type:'directory',version:'v1'};},async *streamText(target){yield content.get(target.targetKey);}};
 const options={cwd:route.aliasPath,dshHome:join(root,'home'),maxBytes:65536};assert.match((await native.loadBaselineInstructions(options,fs)).text,/Remote project instructions/);assert.ok(!seen.some(path=>path===join(root,'projects','.git')));
 seen.length=0;assert.match((await native.loadBaselineInstructions({...options,cwd:localCwd},fs)).text,/Local ancestor instructions/);assert.ok(seen.includes(join(localRoot,'.git')));
 await m.removeServer('test');await assert.rejects(native.loadBaselineInstructions(options,fs),/no longer configured/);
});
test('instruction root hook rejects unsupported SDK signatures',()=>{assert.throws(()=>Hooks.injectInstructionRootHook('renamed discovery'),/signature changed/);});
