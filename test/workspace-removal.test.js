import test from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import {mkdtemp,readFile,writeFile,mkdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Manager from '../src/provider/manager.js';
const server={id:'host',label:'Test host',sshTarget:'example.invalid'};
const tick=()=>new Promise(r=>setImmediate(r));
async function fixture(t,root,records=new Map()){
 root??=await mkdtemp(join(tmpdir(),'dsh-project-retirement-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const ctx=new Context();let counter=0;
 const registry={get:id=>records.get(id),list:()=>[...records.values()],async create(path,title){const existing=[...records.values()].find(x=>x.path===path);if(existing)return existing;const record={id:'native-'+(++counter),path,title,async setTitle(value){this.title=value;}};records.set(record.id,record);ctx.emit('domain/changed',{domain:'workspace',table:'workspaces',operation:'put',key:record.id,value:{path,title}});return record;},async delete(id){records.delete(id);ctx.emit('domain/changed',{domain:'workspace',table:'workspaces',operation:'deleted',key:id});return true;}};
 ctx.provide('workspaceRegistry',registry);await ctx.plugin(Manager,{aliasRoot:join(root,'projects'),servers:[server]});t.after(()=>ctx.fiber.dispose());await tick();
 return {ctx,m:ctx.remoteSshManager,registry,root,records};
}
test('native sidebar deletion retires the durable mapping and empty alias; restart cannot recreate it',async t=>{
 const f=await fixture(t),route=await f.m.addWorkspace(server.id,'/remote/project'),nativeId=route.workspace.registryWorkspaceId;
 assert.ok(nativeId);assert.equal(JSON.parse(await readFile(join(f.root,'catalog.json'),'utf8')).workspaces[0].registryWorkspaceId,nativeId);
 await f.registry.delete(nativeId);await f.m.retirementTail;assert.equal(f.m.snapshot().workspaces.length,0);assert.equal(f.records.size,0);await assert.rejects(stat(route.aliasPath),{code:'ENOENT'});assert.throws(()=>f.m.route(route.aliasPath),/no longer configured/);
 await f.ctx.fiber.dispose();const next=await fixture(t,f.root,f.records);assert.equal(next.m.snapshot().workspaces.length,0);assert.equal(next.records.size,0);
});
test('two rapid native deletions remove both aliases without restoring stale catalog snapshots',async t=>{
 const f=await fixture(t),a=await f.m.addWorkspace(server.id,'/remote/a'),b=await f.m.addWorkspace(server.id,'/remote/b'),stale=f.m.snapshot();
 await Promise.all([f.registry.delete(a.workspace.registryWorkspaceId),f.registry.delete(b.workspace.registryWorkspaceId)]);await f.m.retirementTail;await f.m.replaceSettings(stale);
 assert.equal(f.m.snapshot().workspaces.length,0);assert.equal(f.records.size,0);await assert.rejects(stat(a.aliasPath),{code:'ENOENT'});await assert.rejects(stat(b.aliasPath),{code:'ENOENT'});
});
test('offline native deletion is reconciled from durable native identity; pending/rolled-back deletion is preserved',async t=>{
 const f=await fixture(t),route=await f.m.addWorkspace(server.id,'/remote/project'),record=f.registry.get(route.workspace.registryWorkspaceId);
 f.records.delete(record.id);await f.m.registerAllWorkspaces();assert.equal(f.m.snapshot().workspaces.length,1,'an uncommitted delete must not retire routing');f.records.set(record.id,record);
 await f.ctx.fiber.dispose();f.records.clear();const next=await fixture(t,f.root,f.records);await tick();await next.m.retirementTail;assert.equal(next.m.snapshot().workspaces.length,0);assert.equal(next.records.size,0);
});
test('deleting a remote project preserves local non-empty directories and remote/session data',async t=>{
 const f=await fixture(t),route=await f.m.addWorkspace(server.id,'/remote/project'),file=join(route.aliasPath,'keep.txt');await writeFile(file,'local user content');
 await f.m.removeWorkspace(route.workspace.id);assert.equal(f.records.size,0);assert.equal(await readFile(file,'utf8'),'local user content');assert.deepEqual(await f.m.cleanupLocalAliases(),{removed:0,retained:1});
 const outside=join(f.root,'user-directory');await mkdir(outside);assert.equal(await f.m.cleanupAlias(outside),false);assert.ok((await stat(outside)).isDirectory());
});

test('removal without a native registry records a tombstone which cleans the old native row on next attachment',async t=>{
 const f=await fixture(t),route=await f.m.addWorkspace(server.id,'/remote/project');f.m.workspaceRegistry=undefined;await f.m.removeWorkspace(route.workspace.id);assert.equal(f.records.size,1);
 assert.ok(f.m.snapshot().deletedWorkspaceAliases.length);await f.ctx.fiber.dispose();const next=await fixture(t,f.root,f.records);await tick();assert.equal(next.records.size,0);assert.equal(next.m.snapshot().workspaces.length,0);
});

test('per-project deletion markers survive an older process replacing the entire catalog with stale data',async t=>{
 const f=await fixture(t),route=await f.m.addWorkspace(server.id,'/remote/project'),stale=f.m.snapshot();f.m.workspaceRegistry=undefined;await f.m.removeWorkspace(route.workspace.id);await f.ctx.fiber.dispose();
 await writeFile(join(f.root,'catalog.json'),JSON.stringify(stale));const next=await fixture(t,f.root,f.records);await tick();assert.equal(next.m.snapshot().workspaces.length,0);assert.equal(next.records.size,0);await assert.rejects(stat(route.aliasPath),{code:'ENOENT'});
});
