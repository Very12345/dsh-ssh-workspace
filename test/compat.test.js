import test from 'node:test';import assert from 'node:assert/strict';import {Context} from '@deepseek-ai/cordis';import {guardLocalGitBash} from '../src/compat.js';
test('Git Bash switch stays enabled locally and skips remote agents without duplicate tools',async()=>{
 const ctx=new Context(),calls=[],records=new Map(),remote={session:{header:{cwd:'/alias'}}},local={session:{header:{cwd:'/local'}}};let disposed=false;
 records.set(remote,{dispose:async()=>{disposed=true;}});
 const service={records,creating:new Map(),enabled:true,async synchronizeAgent(agent){calls.push(agent);},async synchronize(){await this.synchronizeAgent(remote);await this.synchronizeAgent(local);}};
 const original=service.synchronizeAgent;ctx.provide('gitBashSwitch',service);await guardLocalGitBash(ctx,{wasRemoteAlias:cwd=>cwd==='/alias'});
 await service.synchronize();assert.equal(service.enabled,true);assert.equal(records.has(remote),false);assert.equal(disposed,true);assert.ok(calls.every(agent=>agent===local));await ctx.fiber.dispose();assert.equal(service.synchronizeAgent,original);
});
