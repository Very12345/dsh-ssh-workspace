import {posix,resolve,dirname,isAbsolute} from 'node:path';
import {opendir,stat,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {manualServer,configServer,effectiveHost} from './hosts.js';
import {discoverSshConfigHosts,defaultSshConfigFiles} from './provider/config.js';
import {initializeHost} from './initialize.js';
export const name='ssh-workspace';
export const inject=['remoteSshManager'];
export const ROUTE='/plugins/ssh-workspace';
export function createAPI(manager){
 let tail=Promise.resolve();
 const api={
  async catalog(){const s=manager.snapshot(),discovery=await discoverSshConfigHosts(s.sshConfigFile?[s.sshConfigFile]:defaultSshConfigFiles());return {ok:true,servers:s.servers,workspaces:s.workspaces,configFile:s.sshConfigFile||'',configHosts:discovery.hosts,errors:discovery.errors};},
  perform(input,signal){const run=tail.then(()=>this.dispatch(input,signal));tail=run.catch(()=>{});return run;},
  async dispatch(input,signal){
   signal?.throwIfAborted();
   if(!input||typeof input.action!=='string')throw new Error('Action required');
   const snapshot=manager.snapshot();
   switch(input.action){
    case 'local-list':return listLocal(input.path);
    case 'local-mkdir':{validateFolderName(input.name);if(typeof input.path!=='string'||!isAbsolute(input.path))throw new Error('Select an absolute local directory');const path=resolve(input.path,input.name);await mkdir(path);return path;}
    case 'mkdir':{const server=snapshot.servers.find(s=>s.id===input.id);if(!server)throw new Error('Unknown SSH host');validateFolderName(input.name);return manager.createRemoteDirectory(server,input.path,input.name);}
    case 'add':return manager.addServer(manualServer(input));
    case 'import':{const discovery=await discoverSshConfigHosts(snapshot.sshConfigFile?[snapshot.sshConfigFile]:defaultSshConfigFiles());const host=discovery.hosts.find(h=>h.sshTarget===input.alias);if(!host)throw new Error('SSH alias not discovered');await effectiveHost(host.sshTarget,snapshot.sshConfigFile,signal);const existing=snapshot.servers.find(s=>s.id===host.id);return existing||manager.addServer(configServer(host));}
    case 'config':await manager.setSshConfigFile(input.path||undefined);return true;
    case 'remove':return manager.removeServer(input.id);
    case 'initialize':{const server=snapshot.servers.find(s=>s.id===input.id);if(!server)throw new Error('Unknown SSH host');const remoteCodeCommand=await initializeHost(server,snapshot.sshConfigFile,signal);return manager.updateServer(server.id,{remoteCodeCommand});}
    case 'list':{const server=snapshot.servers.find(s=>s.id===input.id);if(!server)throw new Error('Unknown SSH host');return manager.listRemoteDirectory(server,input.path);}
    case 'project':{const server=snapshot.servers.find(s=>s.id===input.id);if(!server)throw new Error('Unknown SSH host');if(typeof input.path!=='string'||!posix.isAbsolute(input.path))throw new Error('Select an absolute remote directory');const listed=await manager.listRemoteDirectory(server,input.path);const previous=snapshot.workspaces.find(w=>w.serverId===server.id&&w.remotePath===listed.path);const route=previous?manager.workspace(previous.id):await manager.addWorkspace(server.id,listed.path);return {aliasPath:route.aliasPath,remotePath:route.workspace.remotePath};}
    default:throw new Error('Unknown action');
   }
  }
 };
 return api;
}
export function apply(ctx){
 const api=createAPI(ctx.remoteSshManager);
 ctx.provide('sshWorkspace',api);
 ctx.inject(['webServer'],web=>web.effect(()=>web.webServer.register({kind:'exact',path:ROUTE,handler:async(req,res)=>{
  const send=(status,value)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  const abort=new AbortController();req.on('aborted',()=>abort.abort());res.on?.('close',()=>{if(!res.writableEnded)abort.abort();});
  try {if(req.method==='GET')return send(200,await api.catalog());if(req.method!=='POST')return send(405,{ok:false,error:'Method not allowed'});let body='';for await(const b of req){body+=b;if(body.length>16384)throw new Error('Request too large');}const value=await api.perform(JSON.parse(body),abort.signal);send(200,{ok:true,value});}catch(error){send(400,{ok:false,error:error.message});}
 }})));
}

export async function listLocal(input){
 if(input!==undefined&&(typeof input!=="string"||!isAbsolute(input)))throw new Error("Select an absolute local directory");
 const path=resolve(input||homedir()),entries=[];
 const directory=await opendir(path);let truncated=false;
 for await(const entry of directory){
  if(!entry.isDirectory()&&!(entry.isSymbolicLink()&&(await stat(resolve(path,entry.name)).catch(()=>null))?.isDirectory()))continue;
  if(entries.length===1000){truncated=true;break;}
  entries.push({name:entry.name,path:resolve(path,entry.name),hidden:entry.name.startsWith('.')});
 }
 entries.sort((a,b)=>a.name.localeCompare(b.name));
 const crumbs=[];for(let current=path;;){const parent=dirname(current);crumbs.unshift({name:parent===current?current:current.slice(parent.length).replace(/^[\\/]/,''),path:current,hidden:false});if(parent===current)break;current=parent;}
 return {path,home:homedir(),parent:dirname(path)!==path?dirname(path):undefined,crumbs,entries,truncated};
}

export function validateFolderName(name){if(typeof name!=='string'||!name.trim()||name==='.'||name==='..'||/[\\/\0\r\n]/.test(name))throw new Error('Enter a single folder name');}
