export const inject=['fs','subprocess','spillStore','shell'];
export function apply(ctx){ctx.provide('localFs',ctx.fs);ctx.provide('localSubprocess',ctx.subprocess);ctx.provide('localSpillStore',ctx.spillStore);ctx.provide('sshLocalShell',ctx.shell);}
