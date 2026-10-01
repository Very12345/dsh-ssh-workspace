/** Cooperate with the maintained Git Bash switch without changing its local setting. */
export function guardLocalGitBash(ctx,manager){
 return ctx.inject(['gitBashSwitch'],child=>child.effect(()=>{
  const switcher=child.gitBashSwitch,original=switcher.synchronizeAgent;
  const wrapper=async function(agent){
   const cwd=agent.session.header.cwd;
   if(cwd&&manager.wasRemoteAlias(cwd)){
    await this.creating?.get(agent)?.catch(()=>{});
    const record=this.records?.get(agent);this.records?.delete(agent);await record?.dispose();
    return;
   }
   return original.call(this,agent);
  };
  switcher.synchronizeAgent=wrapper;
  // A plugin added to an already running host may meet existing overlays.
  void switcher.synchronize().catch(e=>child.logger.error(e));
  return ()=>{switcher.synchronizeAgent=original;};
 }));
}
