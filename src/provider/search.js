// Derived from Yan-Zero/dsh-remote-ssh 21d727cbe24fbae283196e5101adb3de2bdd9157 (Apache-2.0).
// See PROVIDER-LICENSE and NOTICE. Maintained snapshot for DSH SSH Workspace.

// .tmp/provider/src/transport/search.ts
import { registerHooks } from "node:module";
import { posix } from "node:path";
var INSTRUCTIONS_PACKAGE = "@deepseek-ai/dsh-agent-instructions";
var ROOT_SYMBOL = Symbol.for("dsh-ssh-workspace.instruction-root");
var SEARCH_PACKAGE = "@deepseek-ai/dsh-tool-fs-search";
var HOOK_SYMBOL_NAME = "dsh-remote-ssh.search-path-parser";
var HOOK_SYMBOL = Symbol.for(HOOK_SYMBOL_NAME);
var FUNCTION_START = /function toWorkdirRelative\(path,\s*workdir\)\s*\{/;
var FUNCTION_HOOK = `
	const remotePath = globalThis[Symbol.for(${JSON.stringify(HOOK_SYMBOL_NAME)})]?.(path, workdir);
	if (remotePath !== void 0) return remotePath;`;
var name = "dsh-remote-ssh-search";
var inject = ["remoteSshManager", "loader"];
function apply(ctx) {
  const target = globalThis;
  const previous = target[HOOK_SYMBOL];
  const hook = (path, workdir) => remoteAbsolutePath(ctx.remoteSshManager, path, workdir);
  target[HOOK_SYMBOL] = hook;
  const previousRoot=target[ROOT_SYMBOL];
  const rootHook=cwd=>remoteInstructionRoot(ctx.remoteSshManager,cwd);
  target[ROOT_SYMBOL]=rootHook;
  const moduleHooks = registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (loaded.source === void 0) return loaded;
      if (isInstructionsModule(url)) return {...loaded,source:injectInstructionRootHook(sourceText(loaded.source))};
      if (!isSearchParserModule(url)) return loaded;
      return { ...loaded, source: injectSearchPathHook(sourceText(loaded.source)) };
    }
  });
  for (const url of ctx.loader.internal?.loadCache.keys() ?? []) {
    if (!isSearchPackageModule(url) && !isInstructionsModule(url)) continue;
    ctx.loader.internal?.loadCache.delete(url);
  }
  ctx.provide("remoteSshSearchHook", {});
  ctx.effect(() => () => {
    moduleHooks.deregister();
    if (target[ROOT_SYMBOL] === rootHook) {if(previousRoot===undefined)delete target[ROOT_SYMBOL];else target[ROOT_SYMBOL]=previousRoot;}
    if (target[HOOK_SYMBOL] !== hook) return;
    if (previous === void 0) delete target[HOOK_SYMBOL];
    else target[HOOK_SYMBOL] = previous;
  }, "Remote SSH search parser hook");
}
function injectSearchPathHook(source) {
  if (source.includes(HOOK_SYMBOL_NAME)) return source;
  if (!FUNCTION_START.test(source)) {
    throw new Error("dsh-remote-ssh: stock search path parser signature changed");
  }
  return source.replace(FUNCTION_START, (match) => match + FUNCTION_HOOK);
}
function remoteAbsolutePath(manager, path, workdir) {
  const route = manager.route(void 0, workdir);
  if (route.kind !== "remote") return void 0;
  const remoteWorkdir = route.mapper.toRemotePath(workdir, route.aliasPath);
  return posix.resolve(remoteWorkdir, path);
}
function sourceText(source) {
  if (typeof source === "string") return source;
  if (source instanceof ArrayBuffer) return Buffer.from(source).toString("utf8");
  return Buffer.from(source.buffer, source.byteOffset, source.byteLength).toString("utf8");
}
function normalizedModuleUrl(url) {
  const decoded = decodeURIComponent(url).replaceAll("\\", "/");
  const query = decoded.indexOf("?");
  return query === -1 ? decoded : decoded.slice(0, query);
}
function isSearchParserModule(url) {
  const decoded = normalizedModuleUrl(url);
  return decoded.endsWith(`/${SEARCH_PACKAGE}/lib/index.js`) || decoded.endsWith("/packages/fs/tool-fs-search/lib/index.js") || decoded.endsWith("/packages/fs/tool-fs-search/src/search-core.ts");
}
function isSearchPackageModule(url) {
  const decoded = normalizedModuleUrl(url);
  return decoded.includes(`/${SEARCH_PACKAGE}/`) || decoded.includes("/packages/fs/tool-fs-search/");
}

function isInstructionsModule(url){
 const decoded=normalizedModuleUrl(url);
 return decoded.endsWith(`/${INSTRUCTIONS_PACKAGE}/lib/index.js`) || decoded.endsWith("/packages/context/agent-instructions/lib/index.js") || decoded.endsWith("/packages/context/agent-instructions/src/discovery.ts");
}
function remoteInstructionRoot(manager,cwd){
 const route=manager.route(undefined,cwd);
 return route.kind==="remote" ? cwd : undefined;
}
function injectInstructionRootHook(source){
 const symbol="dsh-ssh-workspace.instruction-root";
 if(source.includes(symbol))return source;
 const start=/async function findProjectRoot\(cwd,\s*markers,\s*fileSystem,\s*signal\)\s*\{/;
 if(!start.test(source))throw new Error("DSH instruction root discovery signature changed");
 return source.replace(start,match=>match+`\n const remoteRoot=globalThis[Symbol.for("${symbol}")]?.(cwd);\n if(remoteRoot!==undefined)return remoteRoot;`);
}

var search_default = apply;
export {
  apply,
  search_default as default,
  inject,
  injectSearchPathHook,
  injectInstructionRootHook,
  remoteInstructionRoot,
  name,
  remoteAbsolutePath
};
