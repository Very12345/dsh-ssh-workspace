import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import Manager from '../src/provider/manager.js';
import {manualServer} from '../src/hosts.js';
import {discoverSshConfigHosts} from '../src/provider/config.js';
import {createAPI,listLocal,validateFolderName} from '../src/index.js';
import WorkspaceShell from '../src/shell.js';
import {injectSearchPathHook,remoteAbsolutePath} from '../src/provider/search.js';
const temp=async t=>{const p=await mkdtemp(join(tmpdir(),'dsh-ssh-test-'));t.after(()=>rm(p,{recursive:true,force:true}));return p;};
async function manager(t){const root=await temp(t),ctx=new Context();await ctx.plugin(Manager,{aliasRoot:join(root,'projects')});t.after(()=>ctx.fiber.dispose());return {m:ctx.remoteSshManager,ctx,root};}
const server={id:'test',label:'Test host',sshTarget:'example.invalid'};

test('status snapshots observe existing hosts without acquiring or starting connections',async t=>{
 const {m}=await manager(t);await m.addServer(server);const route=await m.addWorkspace(server.id,'/remote/project');
 m.hostContext=()=>{throw new Error('Status must not open SSH');};
 assert.equal(m.connectionStatuses().servers[0].state,'idle');assert.equal(m.connectionStatuses().workspaces[0].aliasPath,route.aliasPath);
 m.hosts.set(server.id,new Promise(()=>{}));assert.equal(m.connectionStatuses().servers[0].state,'connecting');m.hosts.delete(server.id);
 m.observedHosts=new Map([[server.id,{remote:{monitor:{snapshot:()=>({state:'disconnected',updatedAt:123})}}}]]);assert.equal(m.connectionStatuses().servers[0].state,'disconnected');
});
test('manual host validates destination, username, port and options',()=>{
 const s=manualServer({hostname:'example.invalid',username:'developer',port:2222,proxyJump:'jump'});
 assert.equal(s.sshTarget,'developer@example.invalid');assert.ok(s.sshArgs.includes('StrictHostKeyChecking=yes'));assert.ok(s.sshArgs.includes('BatchMode=yes'));
 for(const input of [{hostname:'-oProxyCommand=bad'},{hostname:'x; touch y'},{hostname:'x',username:'a b'},{hostname:'x',port:99999},{hostname:'x',identityFile:'x\ny'}])assert.throws(()=>manualServer(input));
});
test('SSH config discovers concrete aliases and includes, omitting wildcards',async t=>{
 const dir=await temp(t);await writeFile(join(dir,'config'),'Include extra.conf\nHost laptop other\n HostName example.invalid\nHost * !excluded\n');await writeFile(join(dir,'extra.conf'),'Host workstation\n User test\nInclude config\n');
 const found=await discoverSshConfigHosts([join(dir,'config')]);assert.deepEqual(found.hosts.map(s=>s.sshTarget).sort(),['laptop','other','workstation']);assert.equal(found.errors.length,0);
});
test('catalog reloads without erasing workspaces on host initialization update',async t=>{
 const {m,root}=await manager(t);await m.addServer(server);const route=await m.addWorkspace('test','/tmp/project');await m.updateServer('test',{remoteCodeCommand:'/cache/code'});
 assert.equal(m.workspace(route.workspace.id).server.remoteCodeCommand,'/cache/code');
 const ctx=new Context();await ctx.plugin(Manager,{aliasRoot:join(root,'projects')});t.after(()=>ctx.fiber.dispose());assert.equal(ctx.remoteSshManager.workspace(route.workspace.id).workspace.remotePath,'/tmp/project');
});
test('remote removal fails closed both before and after restart',async t=>{
 const {m,root}=await manager(t);await m.addServer(server);const route=await m.addWorkspace('test','/tmp/project');m.bindSession('s',{},route.aliasPath);await m.removeServer('test');
 assert.throws(()=>m.route(undefined,route.aliasPath),/no longer configured/);assert.throws(()=>m.routeShell('/tmp','s'),/removed/);
 const ctx=new Context();await ctx.plugin(Manager,{aliasRoot:join(root,'projects')});t.after(()=>ctx.fiber.dispose());assert.throws(()=>ctx.remoteSshManager.route(undefined,route.aliasPath),/no longer configured/);
});
test('ordinary local directories never become remote because POSIX paths overlap',async t=>{
 const {m}=await manager(t);await m.addServer(server);await m.addWorkspace('test','/tmp');assert.equal(m.route('/tmp/file','/tmp').kind,'local');assert.equal(m.route('/tmp/file').kind,'local');
});
test('custom SSH config reaches the actual connection transport',async t=>{
 const {m,root}=await manager(t);await m.setSshConfigFile(join(root,'config'));assert.ok(m.transportFor(server).args.includes(join(root,'config')));
});
test('project creation validates remote directory and concurrent picks reuse one alias',async t=>{
 const {m}=await manager(t);await m.addServer(server);m.listRemoteDirectory=async(_s,path)=>({path,entries:[]});const api=createAPI(m);
 const picks=await Promise.all([api.perform({action:'project',id:'test',path:'/tmp/project'}),api.perform({action:'project',id:'test',path:'/tmp/project'})]);assert.equal(picks[0].aliasPath,picks[1].aliasPath);assert.equal(m.snapshot().workspaces.length,1);await assert.rejects(api.perform({action:'project',id:'test',path:'relative'}),/absolute/);
});
test('local browser lists folders only, handles spaces and bounds the list',async t=>{
 const dir=await temp(t);await mkdir(join(dir,'a folder'));await writeFile(join(dir,'file'),'test');const value=await listLocal(dir);assert.deepEqual(value.entries.map(e=>e.name),['a folder']);await assert.rejects(listLocal('relative'),/absolute/);
});
test('local shell execution keeps native sandbox and per-call policy intact',async t=>{
 const ctx=new Context(),calls=[],local={sandboxMode:'workspace-write',resolve:r=>r,execute:async s=>{calls.push(s);return {result:()=>s};}};
 ctx.provide('sshLocalShell',local);ctx.provide('remoteSshManager',{routeShell:()=>({kind:'local'})});await ctx.plugin(WorkspaceShell,{dialect:'pwsh'});t.after(()=>ctx.fiber.dispose());const spec={command:'test',sandboxPolicy:{mode:'read-only'}};await ctx.shell.execute(spec);assert.equal(calls[0],spec);assert.equal(ctx.shell.sandboxMode,'workspace-write');
});
test('remote search paths remain POSIX while local parser stays unchanged',()=>{
 const manager={route:()=>({kind:'remote',aliasPath:'alias',mapper:{toRemotePath:()=>'/remote/project'}})};assert.equal(remoteAbsolutePath(manager,'src/a.js','alias'),'/remote/project/src/a.js');assert.equal(remoteAbsolutePath({route:()=>({kind:'local'})},'src/a.js','local'),undefined);
 assert.match(injectSearchPathHook('function toWorkdirRelative(path, workdir) { return path; }'),/search-path-parser/);assert.throws(()=>injectSearchPathHook('changed signature'),/signature changed/);
});
test('package ships prepared JS, licenses, with no install-time scripts or permission overrides',async()=>{
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url)));for(const name of ['prepare','postinstall','install'])assert.equal(pkg.scripts[name],undefined);
 const patch=await readFile(new URL('../cordis.patch.yml',import.meta.url),'utf8');assert.doesNotMatch(patch,/policy:\s*never|mode:\s*danger-full-access/);assert.doesNotMatch(patch,/id: directory-picker/);
 await import('../src/policy.js');await import('../src/provider/spill.js');await import('../src/provider/subprocess.js');
});

test('native folder browser adapter supplies breadcrumbs/hidden flags and safe creation',async t=>{
 const {m,root}=await manager(t),api=createAPI(m);await mkdir(join(root,'.hidden'));const listing=await api.perform({action:'local-list',path:root});assert.ok(listing.crumbs.at(-1).path===root);assert.ok(listing.entries.find(e=>e.name==='.hidden').hidden);
 const path=await api.perform({action:'local-mkdir',path:root,name:'new folder'});assert.equal(path,join(root,'new folder'));await assert.rejects(api.perform({action:'local-mkdir',path:root,name:'new folder'}),/exist/i);
 for(const name of ['../escape','a/b','a\\b','.', '..', '', 'x\n'])assert.throws(()=>validateFolderName(name));
});

test('parent .git probes are not deleted workspace aliases; workspace IDs remain reserved',async t=>{
 const {m,root}=await manager(t);await m.addServer(server);const route=await m.addWorkspace('test','/remote/project');
 assert.equal(m.wasRemoteAlias(join(root,'projects','.git')),false);assert.equal(m.route(join(root,'projects','.git')).kind,'local');assert.equal(m.wasRemoteAlias(join(root,'projects')),false);
 assert.equal(m.route(join(route.aliasPath,'.git')).kind,'remote');await m.removeServer('test');assert.throws(()=>m.route(join(route.aliasPath,'.git')),/no longer configured/);assert.throws(()=>m.route(join(root,'projects','00000000-0000-0000-0000-000000000001','file')),/no longer configured/);
});
test('removed custom aliases retain durable tombstones after restart',async t=>{
 const root=await temp(t),alias=join(root,'custom-alias'),ctx=new Context();await ctx.plugin(Manager,{aliasRoot:join(root,'projects'),servers:[server],workspaces:[{id:'named-workspace',serverId:'test',remotePath:'/remote/project',aliasPath:alias}]});t.after(()=>ctx.fiber.dispose());await ctx.remoteSshManager.removeServer('test');
 const restarted=new Context();await restarted.plugin(Manager,{aliasRoot:join(root,'projects')});t.after(()=>restarted.fiber.dispose());assert.throws(()=>restarted.remoteSshManager.route(join(alias,'.git')),/no longer configured/);
});
