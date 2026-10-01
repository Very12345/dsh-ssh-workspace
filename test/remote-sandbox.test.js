import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {buildRemoteSandbox,sandboxOutcome,quote} from '../src/remote-sandbox.js';
test('remote Landlock preserves each native permission and root allowlist',()=>{
 const backend={kind:'landlock',executable:'/cache/landlock-run',enforcement:'partial'},argv=['/bin/bash','/control/command.sh'];
 const ro=buildRemoteSandbox(backend,{mode:'read-only'},[],argv);assert.deepEqual(ro.argv,['/cache/landlock-run','--ro','/','--rw','/dev/null','--',...argv]);assert.equal(ro.mode,'read-only');
 const rw=buildRemoteSandbox(backend,{mode:'workspace-write'},['/remote/project','/tmp'],argv);assert.ok(rw.argv.includes('/remote/project'));assert.ok(rw.argv.includes('/tmp'));assert.equal(rw.mode,'workspace-write');
 const full=buildRemoteSandbox(null,{mode:'danger-full-access'},[],argv);assert.equal(full.argv,argv);assert.equal(full.mode,'danger-full-access');assert.throws(()=>buildRemoteSandbox(backend,{mode:'invented'},[],argv),/Unknown sandbox mode/);
});
test('remote sandbox reports denial, runner failure and partial enforcement honestly',()=>{
 const plan=buildRemoteSandbox({kind:'landlock',executable:'/runner',enforcement:'partial'},{mode:'workspace-write'},['/project'],['bash']);assert.deepEqual(sandboxOutcome(plan,1,'bash: Permission denied'),{mode:'workspace-write',enforcement:'partial',denied:true});assert.equal(sandboxOutcome(plan,125,'landlock-run: kernel failure').runnerFailed,true);assert.equal(sandboxOutcome(plan,1,'landlock-run: partial enforcement (older Landlock ABI)\nPermission denied').runnerFailed,undefined);assert.equal(sandboxOutcome(plan,0,'Permission denied').denied,false);
});
test('macOS and bwrap profiles preserve read-only and workspace grants',()=>{
 const seatbelt=buildRemoteSandbox({kind:'seatbelt',executable:'/usr/bin/sandbox-exec',enforcement:'full'},{mode:'workspace-write'},['/project with "quotes"','/private/tmp'],['/bin/bash']);assert.match(seatbelt.argv[2],/deny file-write/);assert.ok(seatbelt.argv[2].includes('/private/tmp'));
 const bwrap=buildRemoteSandbox({kind:'bwrap',executable:'/usr/bin/bwrap',enforcement:'full'},{mode:'workspace-write'},['/project','/tmp'],['bash'],'/tmp/host-control');assert.ok(bwrap.argv.includes('--tmpfs'));assert.ok(bwrap.argv.includes('/tmp/host-control'));assert.ok(bwrap.argv.includes('--ro-bind'));
 assert.equal(quote("a'b"),"'a'\"'\"'b'");assert.throws(()=>quote('a\0b'),/Invalid/);
});
test('bundled official Landlock runners match pinned binary digests',async()=>{
 for(const [arch,expected]of Object.entries({x64:'a752bc72f111fcc573c3e61fb90fa544541dac0ca498d2e279e1630d7c659b31',arm64:'f6ae2ad5893e3123f45329ade5518b33c3ac3b102978001ff1c6a6a8ebe2ad9b'}))assert.equal(createHash('sha256').update(await readFile(new URL('../src/assets/linux-'+arch+'/landlock-run',import.meta.url))).digest('hex'),expected);
});
