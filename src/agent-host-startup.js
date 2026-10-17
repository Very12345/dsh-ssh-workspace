// Adapted from the Yan-Zero/dsh-remote-ssh transport snapshot (Apache-2.0).
// See PROVIDER-LICENSE and NOTICE. Shared maintained startup policy.
export const VALIDATED_SERVER_COMMIT='07f806f999227108933c2e30515b26eecc1fda74';
export function cachedAgentHostsCommand(){
 return [
  'dsh_cached="$HOME/.dsh-ssh-workspace/cli/servers/Stable-'+VALIDATED_SERVER_COMMIT+'/server/bin/code-server"',
  'if [ -x "$dsh_cached" ]; then printf \'%s\\n\' "$dsh_cached"; fi',
  'find "$HOME/.vscode-server/cli/servers" -type f -path \'*/server/bin/code-server\' -perm -u+x -printf \'%T@ %p\\n\' 2>/dev/null | sort -nr | cut -d \' \' -f 2-'
 ].join('\n');
}
function managedCommand(command){
 return command==='code'||/\/\.dsh-ssh-workspace\/cli\/code$/.test(command);
}
export async function openAgentHost(runtime,helpers){
 const {runCaptured,buildRemoteAgentHostCommand,stripAnsi,tailDiagnostic,connectionDiagnostic}=helpers;
 const diagnostics=[],attempted=new Set();
 let attempt=0;
 const tryCaches=async()=>{
  const candidates=await runtime.listEmbeddedAgentHosts();
  for(const candidate of candidates.slice(0,8)){
   if(attempted.has(candidate))continue;
   attempted.add(candidate);
   try{return await runtime.connectEndpoint(await runtime.startEmbeddedAgentHost(candidate,attempt++));}
   catch(error){runtime.resetSshAttempt();diagnostics.push('cached Agent Host: '+connectionDiagnostic(error,runtime.config.protocolVersions));}
  }
 };
 const automatic=managedCommand(runtime.config.remoteCodeCommand);
 // The CLI resolves the current stable server, even when the CLI binary is
 // pinned. Reuse a known installed server before any release lookup/download.
 if(automatic){
  try{const connected=await tryCaches();if(connected)return connected;}
  catch(error){diagnostics.push('cache discovery: '+tailDiagnostic(error.message||String(error)));}
 }
 let startup;
 try{
  startup=await runCaptured(runtime.config.sshExecutable,
   [...runtime.config.sshArgs,'-T',runtime.config.sshTarget,buildRemoteAgentHostCommand(runtime.config.remoteCodeCommand)],
   Math.min(runtime.config.startupTimeoutMs,45000));
 }catch(error){
  if(!automatic)throw error;
  diagnostics.push('standalone CLI: '+tailDiagnostic(error.message||String(error)));
  startup={exitCode:null,stdout:'',stderr:''};
 }
 const clean=stripAnsi(startup.stdout+'\n'+startup.stderr);
 const endpoint=/ws:\/\/(?:localhost|127\.0\.0\.1):(\d+)\?tkn=([^\s]+)/.exec(clean);
 if(endpoint){
  try{return await runtime.connectEndpoint(await runtime.openTunnel(Number(endpoint[1]),endpoint[2]));}
  catch(error){runtime.resetSshAttempt();diagnostics.push('standalone CLI: '+connectionDiagnostic(error,runtime.config.protocolVersions));}
 }else if(clean.trim())diagnostics.push('standalone CLI (ssh exit '+(startup.exitCode??'unknown')+'): '+tailDiagnostic(clean));
 if(automatic){
  // A completed online install may have made a compatible cache available.
  try{const connected=await tryCaches();if(connected)return connected;}
  catch(error){diagnostics.push('cache discovery: '+tailDiagnostic(error.message||String(error)));}
 }
 const detail=diagnostics.join('\n').replace(/([?&]tkn=)[^\s]+/g,'$1[redacted]');
 throw Object.assign(new Error('远程目录浏览需要 SSH 和 Agent Host。远端运行环境启动失败；请检查远端 DNS／下载网络，或在设置中初始化环境。\n'+detail),
  {code:'ssh_agent_host_unavailable'});
}
