import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const execute=promisify(execFile);
export function sshExecutable(){
 const locations=process.platform==='win32'?[path.join(process.env.SystemRoot||'C:/Windows','System32/OpenSSH/ssh.exe'),path.join(process.env.ProgramFiles||'C:/Program Files','Git/usr/bin/ssh.exe')]:[];
 return locations.find(p=>fs.existsSync(p))||'ssh';
}
const text=(v,name)=>{if(typeof v!=='string'||!v.trim()||/[\r\n\0]/.test(v))throw new Error(name+' must be non-empty single-line text');return v.trim();};
export function manualServer(input){
 const host=text(input.hostname,'hostname');if(!/^[a-zA-Z0-9_.:[\]-]+$/.test(host)||host.startsWith('-'))throw new Error('Invalid hostname');
 const user=(input.username||'').trim();if(user&&!/^[a-zA-Z0-9_.-]+$/.test(user))throw new Error('Invalid username');
 const port=Number(input.port||22);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port');
 const sshArgs=['-p',String(port),'-o','StrictHostKeyChecking=yes','-o','BatchMode=yes'];
 if(input.identityFile)sshArgs.push('-i',text(input.identityFile,'identity file'));
 if(input.proxyJump)sshArgs.push('-J',text(input.proxyJump,'jump host'));
 return {id:input.id||randomUUID(),label:input.label?.trim()||`${user?user+'@':''}${host}`,sshTarget:`${user?user+'@':''}${host}`,sshArgs,sshExecutable:sshExecutable()};
}
export async function effectiveHost(alias,configFile,signal){
 text(alias,'SSH alias');if(alias.startsWith('-')||/[\s*?!]/.test(alias))throw new Error('Select a concrete SSH alias');
 const args=['-G',...(configFile?['-F',configFile]:[]),'--',alias];
 const {stdout}=await execute(sshExecutable(),args,{windowsHide:true,timeout:10000,maxBuffer:1024*1024,signal});
 const values={};for(const line of stdout.split(/\r?\n/)){const split=line.indexOf(' ');if(split>0){const key=line.slice(0,split);if(values[key]===undefined)values[key]=line.slice(split+1);}}
 return {alias,hostname:values.hostname||alias,username:values.user||'',port:Number(values.port||22),identity:!!values.identityfile&&values.identityfile!=='none',jump:values.proxyjump&&values.proxyjump!=='none'};
}
export function configServer(host){return {id:host.id,label:host.label,sshTarget:host.sshTarget,sshExecutable:sshExecutable(),sshArgs:['-o','StrictHostKeyChecking=yes','-o','BatchMode=yes']};}
