import {ShellExecutor} from '@deepseek-ai/dsh-shell';
import z from '@deepseek-ai/schemastery';
/** Route remote commands while preserving the stock local sandbox executor. */
export class WorkspaceShell extends ShellExecutor {
 static inject=['remoteSshManager','sshLocalShell'];
 static Config=z.object({dialect:z.union(['bash','pwsh']).required()});
 constructor(ctx,config){super(ctx);this.manager=ctx.remoteSshManager;this.dialect=config.dialect;this.local=ctx.sshLocalShell;}
 get sandboxMode(){return this.local.sandboxMode;}
 resolve(request){return this.local.resolve(request);}
 async execute(spec){const route=this.manager.routeShell(spec.workdir,spec.dshEnv?.DSH_SESSION_ID);return route.kind==='local'?this.local.execute(spec):(await this.manager.workspaceShell(route,'bash')).execute(spec);}
 async run(spec){const route=this.manager.routeShell(spec.workdir,spec.dshEnv?.DSH_SESSION_ID);return route.kind==='local'?this.local.run(spec):(await this.manager.workspaceShell(route,'bash')).run(spec);}
 start(spec){const route=this.manager.routeShell(spec.workdir,spec.dshEnv?.DSH_SESSION_ID);if(route.kind==='local')return this.local.start(spec);return deferred(this.manager.workspaceShell(route,'bash'),spec);}
}
function deferred(shell,spec){let inner,killed=false;const process={status:'running',exitCode:null,signal:null,readOutput:()=>inner?.readOutput()||{delta:'',lossy:false},writeStdin:async text=>{await ready;return inner.writeStdin(text);},kill:()=>{killed=true;return inner?.kill()??true;}};const ready=shell.then(s=>{inner=s.start(spec);if(killed)inner.kill();});process.done=ready.then(()=>inner.done).then(()=>{process.status=inner.status;process.exitCode=inner.exitCode;process.signal=inner.signal;});return process;}
export default WorkspaceShell;
