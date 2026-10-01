import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import {SandboxUnavailableError} from '@deepseek-ai/dsh-sandbox';
const unavailable=detail=>Object.assign(new Error(detail),{code:'SANDBOX_UNAVAILABLE'});
const execute=promisify(execFile),factsCache=new Map(),backendCache=new Map();
const ASSETS={x64:'a752bc72f111fcc573c3e61fb90fa544541dac0ca498d2e279e1630d7c659b31',arm64:'f6ae2ad5893e3123f45329ade5518b33c3ac3b102978001ff1c6a6a8ebe2ad9b'};
export const quote=value=>{if(typeof value!=='string'||value.includes('\0'))throw new Error('Invalid remote argument');return "'"+value.replaceAll("'","'\"'\"'")+"'";};
const uri=path=>'file://'+path.split('/').map(encodeURIComponent).join('/');
async function control(remote,command){
 const c=remote.config;
 return execute(c.sshExecutable,[...c.sshArgs,'-n','-T','-o','ConnectTimeout=10','--',c.sshTarget,command],{windowsHide:true,timeout:30000,maxBuffer:1024*1024});
}
const cacheKey=remote=>remote.clientId??remote;
export function clearRemoteSandbox(remote){factsCache.delete(cacheKey(remote));backendCache.delete(cacheKey(remote));}
export async function remoteFacts(remote){
 const key=cacheKey(remote);let pending=factsCache.get(key);if(!pending){pending=(async()=>{
  const {stdout}=await control(remote,'printf "__DSH_SANDBOX_FACTS__\\n%s\\n%s\\n%s\\n%s\\n" "$(uname -s)" "$(uname -m)" "$HOME" "${TMPDIR:-/tmp}"');
  const [os,arch,home,temp]=stdout.slice(stdout.lastIndexOf('__DSH_SANDBOX_FACTS__')+'__DSH_SANDBOX_FACTS__'.length).trim().split(/\r?\n/);
  if(!['Linux','Darwin'].includes(os)||!home?.startsWith('/')||!temp?.startsWith('/'))throw unavailable('Remote sandbox platform could not be determined');
  return {os,arch,home,temp};
 })();factsCache.set(key,pending);pending.catch(()=>factsCache.delete(key));}return pending;
}
async function canonical(remote,path){
 if(typeof path!=='string'||!posix.isAbsolute(path))throw new Error('Remote policy root must be an absolute POSIX directory');
 const resolved=await (await remote.getClient()).resourceResolve({uri:uri(path),followSymlinks:true});
 if(resolved.type!=='directory')throw new Error('Remote policy root must be a directory');
 const url=new URL(resolved.uri);if(url.protocol!=='file:')throw new Error('Unexpected remote directory URI');return decodeURIComponent(url.pathname);
}
export async function remoteWritableRoots(remote,mapper,policy){
 if(policy.mode!=='workspace-write')return [];
 const facts=await remoteFacts(remote);
 return [...new Set(await Promise.all([mapper.toRemotePath(policy.workspaceRoot),'/tmp',facts.temp].map(p=>canonical(remote,p))))];
}
export async function detectRemoteSandbox(remote){
 const key=cacheKey(remote);let pending=backendCache.get(key);if(!pending){pending=(async()=>{
  const facts=await remoteFacts(remote);
  if(facts.os==='Darwin'){
   try{await control(remote,"/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny file-write*)(allow file-write* (literal \"/dev/null\"))' -- /usr/bin/true");return {kind:'seatbelt',executable:'/usr/bin/sandbox-exec',enforcement:'full'};}catch{throw unavailable('Remote macOS Seatbelt sandbox is unavailable');}
  }
  try{const {stdout}=await control(remote,'command -v bwrap');const executable=stdout.trim();if(!executable.startsWith('/'))throw new Error('Missing bwrap');await control(remote,[executable,'--ro-bind','/','/','--dev','/dev','--unshare-pid','--proc','/proc','--die-with-parent','--','/bin/true'].map(quote).join(' '));return {kind:'bwrap',executable,enforcement:'full'};}catch{}
  const arch=facts.arch==='x86_64'?'x64':facts.arch==='aarch64'||facts.arch==='arm64'?'arm64':null;
  if(!arch)throw unavailable('Remote Linux architecture has no bundled Landlock runner');
  const binary=await readFile(new URL('./assets/linux-'+arch+'/landlock-run',import.meta.url));
  if(createHash('sha256').update(binary).digest('hex')!==ASSETS[arch])throw unavailable('Bundled remote Landlock runner integrity check failed');
  const client=await remote.getClient(),directory=posix.join(facts.home,'.dsh-ssh-workspace/sandbox'),executable=posix.join(directory,'landlock-run-0.1.2-'+ASSETS[arch].slice(0,12));
  await client.resourceMkdir({uri:uri(directory)});
  let valid=false;try{const stored=await client.resourceRead({uri:uri(executable),encoding:'base64'});valid=createHash('sha256').update(Buffer.from(stored.data,'base64')).digest('hex')===ASSETS[arch];}catch{}
  if(!valid)await client.resourceWrite({uri:uri(executable),encoding:'base64',data:binary.toString('base64')});
  try{const {stdout}=await control(remote,'chmod 500 '+quote(executable)+' && '+quote(executable)+' --probe');return {kind:'landlock',executable,enforcement:/partially enforced/.test(stdout)?'partial':'full'};}catch(error){throw unavailable('Remote Linux cannot enforce file permissions with Bubblewrap or Landlock: '+(error.stderr||error.message));}
 })();backendCache.set(key,pending);pending.catch(()=>backendCache.delete(key));}return pending;
}
/** Same file-effect modes and writable roots as DSH's native sandbox provider. */
export function buildRemoteSandbox(backend,policy,roots,argv,runtimeRoot){
 if(!['read-only','workspace-write','danger-full-access'].includes(policy.mode))throw new Error('Unknown sandbox mode');
 if(policy.mode==='danger-full-access')return {argv,mode:policy.mode,denialSignatures:[],runnerFailureRules:[]};
 let wrapped,denialSignatures,runnerFailureRules;
 if(backend.kind==='landlock'){
  wrapped=[backend.executable,'--ro','/','--rw','/dev/null',...roots.flatMap(root=>['--rw',root]),'--',...argv];denialSignatures=['permission denied'];runnerFailureRules=[{allowedExitCodes:[125],fatalSignatures:['landlock-run: '],informationalLines:['landlock-run: partial enforcement (older Landlock ABI)']}];
 }else if(backend.kind==='bwrap'){
  wrapped=[backend.executable,'--ro-bind','/','/','--dev','/dev','--unshare-pid','--proc','/proc','--die-with-parent'];
  if(policy.mode==='workspace-write')wrapped.push('--tmpfs','/tmp');
  for(const root of roots)if(root!=='/tmp')wrapped.push('--bind',root,root);
  if(policy.mode==='workspace-write'&&runtimeRoot)wrapped.push('--ro-bind',runtimeRoot,runtimeRoot);
  wrapped.push('--',...argv);denialSignatures=['read-only file system'];runnerFailureRules=[{fatalSignatures:['bwrap: ']}];
 }else if(backend.kind==='seatbelt'){
  const sbpl=s=>'"'+s.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
  const profile='(version 1)(allow default)(deny file-write*)(allow file-write* (literal "/dev/null"))'+roots.map(root=>'(allow file-write* (subpath '+sbpl(root)+'))').join('');
  wrapped=[backend.executable,'-p',profile,'--',...argv];denialSignatures=['operation not permitted'];runnerFailureRules=[{fatalSignatures:['sandbox-exec: ']}];
 }else throw unavailable('Unknown remote sandbox backend');
 return {argv:wrapped,mode:policy.mode,enforcement:backend.enforcement,denialSignatures,runnerFailureRules};
}
export async function wrapRemoteArgv(remote,mapper,policy,argv){
 policy??={mode:'read-only',workspaceRoot:mapper.localWorkspace};
 if(policy.mode==='danger-full-access')return buildRemoteSandbox(null,policy,[],argv);
 if(!['read-only','workspace-write'].includes(policy.mode))throw new Error('Unknown sandbox mode');
 try {const backend=await detectRemoteSandbox(remote),roots=await remoteWritableRoots(remote,mapper,policy);return buildRemoteSandbox(backend,policy,roots,argv,remote.runtimeRoot);}catch(error){if(error.code==='SANDBOX_UNAVAILABLE')throw new SandboxUnavailableError(policy.mode,error.message);throw error;}
}
export function sandboxOutcome(plan,exitCode,text){
 if(plan.mode==='danger-full-access')return {mode:plan.mode,denied:false};
 const lower=text.toLowerCase(),failed=exitCode!==null&&exitCode!==0;
 const runnerFailed=failed&&plan.runnerFailureRules.some(rule=>(!rule.allowedExitCodes||rule.allowedExitCodes.includes(exitCode))&&text.split(/\r?\n/).some(line=>!rule.informationalLines?.includes(line.toLowerCase())&&rule.fatalSignatures.some(s=>line.toLowerCase().includes(s))));
 return {mode:plan.mode,enforcement:plan.enforcement,denied:failed&&!runnerFailed&&plan.denialSignatures.some(s=>lower.includes(s)),...(runnerFailed?{runnerFailed:true}:{})};
}
