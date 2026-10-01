// Derived from Yan-Zero/dsh-remote-ssh 21d727cbe24fbae283196e5101adb3de2bdd9157 (Apache-2.0).
// See PROVIDER-LICENSE and NOTICE. Maintained snapshot for DSH SSH Workspace.

// .tmp/provider/src/routing/fs.ts
import { posix } from "node:path";
import { FileSystem, FsTargetKey } from "@deepseek-ai/dsh-fs";

// .tmp/provider/src/transport/binary-fs.ts
function binaryWriter(fs) {
  if (typeof fs.writeBytes !== "function") {
    throw new Error("filesystem backend does not implement writeBytes");
  }
  return fs;
}

// .tmp/provider/src/routing/fs.ts
var PREFIX = "dsh-remote-ssh:";
var TransparentFileSystem = class extends FileSystem {
  static inject = ["localFs", "remoteSshManager"];
  local;
  manager;
  constructor(ctx) {
    super(ctx);
    this.local = ctx.localFs;
    this.manager = ctx.remoteSshManager;
  }
  get sandboxMode() { return this.local.sandboxMode; }
  processPathFromHostPath(path) { return this.manager.route(path).kind === "local" ? this.local.processPathFromHostPath?.(path) : undefined; }
  async resolve(path, opts) {
    const route = this.manager.route(path, opts?.cwd);
    if (route.kind === "local") return this.local.resolve(path, opts);
    const remote = await this.manager.workspaceContext(route);
    return wrapTarget(route, await remote.fs.resolve(path, opts));
  }
  processPath(target) {
    const decoded = decodeTarget(target);
    return decoded === void 0 ? this.local.processPath(target) : target.displayPath;
  }
  fileUrl(target) {
    const decoded = decodeTarget(target);
    if (decoded === void 0) return this.local.fileUrl(target);
    const route = this.manager.workspace(decoded.workspaceId);
    return `dsh-remote-ssh://${encodeURIComponent(route.server.id)}/${encodeURIComponent(route.workspace.id)}/${encodeURIComponent(decoded.targetKey)}`;
  }
  contains(parent, child) {
    const parentRemote = decodeTarget(parent);
    const childRemote = decodeTarget(child);
    if (parentRemote === void 0 || childRemote === void 0) {
      return parentRemote === void 0 && childRemote === void 0 && this.local.contains(parent, child);
    }
    if (parentRemote.workspaceId !== childRemote.workspaceId) return false;
    const route = this.manager.workspace(parentRemote.workspaceId);
    const parentPath = route.mapper.toRemotePath(parent.displayPath);
    const childPath = route.mapper.toRemotePath(child.displayPath);
    const rel = posix.relative(parentPath, childPath);
    return rel === "" || rel !== ".." && !rel.startsWith("../") && !posix.isAbsolute(rel);
  }
  async stat(target, signal) {
    const backend = await this.backend(target);
    return backend.fs.stat(backend.target, signal);
  }
  async lstat(path, opts, signal) {
    const route = this.manager.route(path, opts?.cwd);
    if (route.kind === "local") return this.local.lstat(path, opts, signal);
    return (await this.manager.workspaceContext(route)).fs.lstat(path, opts, signal);
  }
  async readText(target, signal) {
    const backend = await this.backend(target);
    return backend.fs.readText(backend.target, signal);
  }
  async streamText(target, signal) {
    const backend = await this.backend(target);
    return backend.fs.streamText(backend.target, signal);
  }
  async readBytes(target, signal, maxBytes) {
    const backend = await this.backend(target);
    return backend.fs.readBytes(backend.target, signal, maxBytes);
  }
  async readByteRange(target, range, signal) {
    const backend = await this.backend(target);
    if (typeof backend.fs.readByteRange === "function") return backend.fs.readByteRange(backend.target, range, signal);
    if (!Number.isSafeInteger(range.offset)||!Number.isSafeInteger(range.length)||range.offset<0||range.length<0) throw new Error("Invalid byte range");
    const bytes = await backend.fs.readBytes(backend.target, signal, 64*1024*1024);
    return bytes.subarray(range.offset, range.offset+range.length);
  }
  async watch(target, changed, signal) {
    const decoded = decodeTarget(target);
    if (decoded === undefined) return this.local.watch(target, changed, signal);
    return super.watch(target, changed, signal);
  }
  async listDir(target, signal) {
    const decoded = decodeTarget(target);
    if (decoded === void 0) return this.local.listDir(target, signal);
    const route = this.manager.workspace(decoded.workspaceId);
    const remote = await this.manager.workspaceContext(route);
    const entries = await remote.fs.listDir(unwrapTarget(target, decoded), signal);
    return entries.map((entry) => ({ ...entry, target: wrapTarget(route, entry.target) }));
  }
  async writeText(target, content, expected, signal, sandboxPolicy) {
    const backend = await this.backend(target);
    return backend.fs.writeText(backend.target, content, expected, signal, sandboxPolicy);
  }
  async writeBytes(target, content, expected, signal, sandboxPolicy) {
    const backend = await this.backend(target);
    return binaryWriter(backend.fs).writeBytes(backend.target, content, expected, signal, sandboxPolicy);
  }
  async editText(target, edit, expected, signal, sandboxPolicy) {
    const backend = await this.backend(target);
    return backend.fs.editText(backend.target, edit, expected, signal, sandboxPolicy);
  }
  async backend(target) {
    const decoded = decodeTarget(target);
    if (decoded === void 0) return { fs: this.local, target };
    const route = this.manager.workspace(decoded.workspaceId);
    const remote = await this.manager.workspaceContext(route);
    return { fs: remote.fs, target: unwrapTarget(target, decoded) };
  }
};
function wrapTarget(route, target) {
  const envelope = { workspaceId: route.workspace.id, targetKey: String(target.targetKey) };
  return {
    targetKey: FsTargetKey(PREFIX + Buffer.from(JSON.stringify(envelope)).toString("base64url")),
    displayPath: target.displayPath
  };
}
function decodeTarget(target) {
  const key = String(target.targetKey);
  if (!key.startsWith(PREFIX)) return void 0;
  try {
    const value = JSON.parse(Buffer.from(key.slice(PREFIX.length), "base64url").toString("utf8"));
    if (typeof value.workspaceId !== "string" || typeof value.targetKey !== "string") throw new Error("invalid fields");
    return value;
  } catch (error) {
    throw new Error(`dsh-remote-ssh: invalid remote filesystem target '${key}'`, { cause: error });
  }
}
function unwrapTarget(target, decoded) {
  return { targetKey: FsTargetKey(decoded.targetKey), displayPath: target.displayPath };
}
var fs_default = TransparentFileSystem;
export {
  TransparentFileSystem,
  fs_default as default
};
