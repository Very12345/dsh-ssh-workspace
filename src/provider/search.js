// Derived from Yan-Zero/dsh-remote-ssh 21d727cbe24fbae283196e5101adb3de2bdd9157 (Apache-2.0).
// See PROVIDER-LICENSE and NOTICE. Maintained snapshot for DSH SSH Workspace.

// .tmp/provider/src/transport/search.ts
import { registerHooks } from "node:module";
import { posix } from "node:path";
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
  const moduleHooks = registerHooks({
    load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (!isSearchParserModule(url) || loaded.source === void 0) return loaded;
      return { ...loaded, source: injectSearchPathHook(sourceText(loaded.source)) };
    }
  });
  for (const url of ctx.loader.internal?.loadCache.keys() ?? []) {
    if (!isSearchPackageModule(url)) continue;
    ctx.loader.internal?.loadCache.delete(url);
  }
  ctx.provide("remoteSshSearchHook", {});
  ctx.effect(() => () => {
    moduleHooks.deregister();
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
var search_default = apply;
export {
  apply,
  search_default as default,
  inject,
  injectSearchPathHook,
  name,
  remoteAbsolutePath
};
