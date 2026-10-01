import {guardLocalGitBash} from './compat.js';
import * as bashTool from '@deepseek-ai/dsh-tool-bash';
import * as persistentBashTool from '@deepseek-ai/dsh-tool-bash-persistent';
import TerminalService from '@deepseek-ai/dsh-terminal';
import * as terminalBackend from '@deepseek-ai/dsh-terminal-bash';
import {scopeOf} from '@deepseek-ai/dsh-scope';
export const name='ssh-workspace-agent-routing';
export const inject=['agents','tools','systemPrompt','remoteSshManager','shell','sandboxPolicy','agentPresets'];
/** Install a scoped Bash presentation only for agents bound to a remote alias. */
export function apply(ctx){
 const records=new Map(),manager=ctx.remoteSshManager;
 guardLocalGitBash(ctx,manager);
 const bind=async agent=>{
  const cwd=agent.session.header.cwd;
  if(!cwd||!manager.wasRemoteAlias(cwd)||records.has(agent))return;
  const route=manager.bindSession(String(agent.session.header.id),agent,cwd);
  if(!route)return;
  const tools=agent.ctx.get('tools'),original=agent.ctx.get('shell'),policy=agent.ctx.get('sandboxPolicy');
  const record={children:[],registration:null,restriction:null};records.set(agent,record);
  const capture={register(definition){record.definition=definition;return()=>{record.definition=null;}}};
  record.group=agent.ctx.plugin({name:'ssh-workspace-agent-shell',apply(parent){
   let child=parent.isolate('tools').isolate('shell');
   const minimal=ctx.agentPresets.composedPreset(agent.ctx)==='minimal';
   if(minimal)child=child.isolate('terminals');
   record.children.push(child.plugin({name:'ssh-workspace-agent-capabilities',apply(inner){
    inner.provide('tools',capture);
    inner.provide('shell',{
     get sandboxMode(){return policy.defaultMode;},
     resolve(request){return {...original.resolve(request),onExpiry:request.onExpiry??'kill',sandboxPolicy:request.sandboxPolicy??policy.resolve({session:agent.session})};},
     async execute(spec){const current=manager.workspace(route.workspace.id);return (await manager.workspaceShell(current,'bash')).execute(spec);}
    });
   }}));
   if(minimal)record.children.push(child.plugin(TerminalService),child.plugin(terminalBackend,{shellPath:'/bin/bash',shellDialect:'bash',shellArgs:['--noprofile','--norc','-i'],timeoutMs:30000}),child.plugin(persistentBashTool,{timeoutMs:300000}));
   else record.children.push(child.plugin(bashTool));
  }});
  try{
   await record.group.await();await Promise.all(record.children.map(child=>child.await()));
   if(!record.definition)throw new Error('Remote Bash tool did not activate');
   // A scoped override keeps other tools and native permissions in place.
   const inherited=tools.get('pwsh',agent);if(inherited)record.restriction=tools.restrict({deny:['pwsh']});
   record.registration=tools.register(record.definition);
   const scope=scopeOf(agent.ctx);
   record.prompt=agent.ctx.on('system-prompt/assemble',(assembly,context)=>context.scope!==scope?assembly:{...assembly,sections:assembly.sections.filter(s=>s.name!=='tool:pwsh')});
   record.cwdPrompt=agent.ctx.get('systemPrompt').variable('cwd',()=>route.workspace.remotePath);
   record.worldPrompt=agent.ctx.get('systemPrompt').section({name:'ssh-workspace:execution-world',order:-10,text:'This project is on a remote Linux/macOS computer. Files and Bash commands operate there using POSIX paths. Local desktop/browser tools still operate on the harness host. Arbitrary remote commands require the session’s native Full Access permission. Never fall back to local shell commands after an SSH error.'});
  }catch(error){records.delete(agent);await record.group.dispose();manager.unbindSession(String(agent.session.header.id),agent);throw error;}
 };
 const dispose=async agent=>{const record=records.get(agent);records.delete(agent);if(record){record.registration?.();record.restriction?.();record.prompt?.();record.cwdPrompt?.();record.worldPrompt?.();await record.group.dispose();}manager.unbindSession(String(agent.session.header.id),agent);};
 ctx.provide('sshWorkspaceRouting',{bind,dispose});
 ctx.on('agent/created',({agent})=>bind(agent));
 ctx.on('agent-preset/selected',async id=>{const agent=ctx.agents.get(id);if(agent){await dispose(agent);await bind(agent);}});
 ctx.on('agent/disposed',({agent})=>dispose(agent));
 ctx.effect(()=>()=>Promise.all([...records.keys()].map(dispose)));
 for(const agent of ctx.agents.list())void bind(agent).catch(e=>ctx.logger.error(e));
}
