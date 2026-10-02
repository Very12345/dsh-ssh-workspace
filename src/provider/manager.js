// Derived from Yan-Zero/dsh-remote-ssh 21d727cbe24fbae283196e5101adb3de2bdd9157 (Apache-2.0).
// See PROVIDER-LICENSE and NOTICE. Maintained snapshot for DSH SSH Workspace.

import {wrapRemoteArgv, sandboxOutcome, remoteWritableRoots, clearRemoteSandbox} from '../remote-sandbox.js';
import {ConnectionStatus} from '../connection-status.js';

// .tmp/provider/src/routing/manager.ts
import { createHash, randomUUID as randomUUID3 } from "node:crypto";
import { spawn as spawn2 } from "node:child_process";
import { mkdir, readFile, writeFile, rename, lstat, rmdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute as isAbsolute2, relative as relative2, resolve as resolve2, sep as sep2 } from "node:path";
import { posix as posix4 } from "node:path";
import { Context as Context2, Service as Service2 } from "@deepseek-ai/cordis";

import z4 from "@deepseek-ai/schemastery";

// .tmp/provider/src/transport/fs.ts
import { posix as posix2 } from "node:path";
import { AhpErrorCodes as AhpErrorCodes2 } from "@microsoft/agent-host-protocol";
import { RpcError as RpcError2 } from "@microsoft/agent-host-protocol/client";
import { FileSystem, FsError, FsTargetKey, FsVersion } from "@deepseek-ai/dsh-fs";
import z2 from "@deepseek-ai/schemastery";

// .tmp/provider/src/transport/runtime.ts
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { posix } from "node:path";
import { AhpClient } from "@microsoft/agent-host-protocol/client";
import { WebSocketTransport } from "@microsoft/agent-host-protocol/ws";
import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

// .tmp/provider/src/transport/ahp-compat.ts
import { AhpErrorCodes, SUPPORTED_PROTOCOL_VERSIONS } from "@microsoft/agent-host-protocol";
import { RpcError } from "@microsoft/agent-host-protocol/client";
var VALIDATED_FORWARD_PROTOCOL_VERSIONS = [];
var DSH_AHP_PROTOCOL_VERSIONS = Object.freeze([
  .../* @__PURE__ */ new Set([
    ...VALIDATED_FORWARD_PROTOCOL_VERSIONS,
    ...SUPPORTED_PROTOCOL_VERSIONS
  ])
]);
function ahpProtocolMismatch(error, offeredVersions = DSH_AHP_PROTOCOL_VERSIONS) {
  if (!(error instanceof RpcError) || error.code !== AhpErrorCodes.UnsupportedProtocolVersion) return void 0;
  const data = typeof error.data === "object" && error.data !== null ? error.data : void 0;
  const serverVersions = Array.isArray(data?.supportedVersions) ? data.supportedVersions.filter((value) => typeof value === "string") : [];
  return { offeredVersions, serverVersions };
}
function formatAhpProtocolMismatch(mismatch) {
  const offered = mismatch.offeredVersions.join(", ") || "none";
  const server = mismatch.serverVersions.join(", ") || "unknown";
  return `client offered [${offered}], Agent Host accepts [${server}]`;
}

// .tmp/provider/src/transport/runtime.ts
function quotePosix(value) {
  if (value.includes("\0")) throw new Error("remote command arguments cannot contain NUL bytes");
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
function buildRemoteAgentHostCommand(remoteCodeCommand) {
  const requested = quotePosix(remoteCodeCommand);
  return [
    `dsh_code=${requested}`,
    'if [ "$dsh_code" = code ] && ! command -v "$dsh_code" >/dev/null 2>&1 && [ -x "$HOME/.dsh-ssh-workspace/cli/code" ]; then dsh_code="$HOME/.dsh-ssh-workspace/cli/code"; fi',
    `if ! command -v "$dsh_code" >/dev/null 2>&1; then printf 'dsh-remote-ssh: VS Code CLI not found: %s\\n' "$dsh_code" >&2; exit 127; fi`,
    'exec "$dsh_code" agent host --host 127.0.0.1 --port 0 --idle-timeout 60 --server-data-dir "$HOME/.dsh-ssh-workspace/server" --cli-data-dir "$HOME/.dsh-ssh-workspace/cli" --verbose'
  ].join("\n");
}
function buildListEmbeddedAgentHostsCommand() {
  return `find "$HOME/.vscode-server/cli/servers" -type f -path '*/server/bin/code-server' -perm -u+x -printf '%T@ %p\\n' 2>/dev/null | sort -nr | cut -d ' ' -f 2-`;
}
function buildEmbeddedAgentHostCommand(codeServerPath, instanceId = "default") {
  if (!/^[a-zA-Z0-9._-]+$/.test(instanceId)) throw new Error(`invalid embedded Agent Host instance id: ${instanceId}`);
  const resolveCodeServer = codeServerPath === void 0 ? `dsh_code_server=$(${buildListEmbeddedAgentHostsCommand()} | head -n 1)` : `dsh_code_server=${quotePosix(codeServerPath)}`;
  return [
    resolveCodeServer,
    `if [ -z "$dsh_code_server" ]; then printf 'dsh-remote-ssh: no usable code agent host or VS Code Server code-server found\\n' >&2; exit 127; fi`,
    `exec "$dsh_code_server" --host 127.0.0.1 --port 0 --agent-host-port 0 --accept-server-license-terms --server-data-dir "$HOME/.dsh-ssh-workspace/server-embedded/${instanceId}" --log info`
  ].join("\n");
}
function fileUriFromPosixPath(path) {
  if (!posix.isAbsolute(path)) throw new Error(`remote path must be absolute: ${path}`);
  return `file://${path.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}
function posixPathFromFileUri(uri) {
  const parsed = new URL(uri);
  if (parsed.protocol !== "file:" || parsed.hostname !== "" && parsed.hostname !== "localhost") {
    throw new Error(`expected a local file URI from Agent Host, received ${uri}`);
  }
  const path = decodeURIComponent(parsed.pathname);
  if (!posix.isAbsolute(path)) throw new Error(`Agent Host returned a non-absolute file URI: ${uri}`);
  return posix.normalize(path);
}
var WorkspacePathMapper = class {
  localWorkspace;
  remoteWorkspace;
  constructor(localWorkspace, remoteWorkspace) {
    this.localWorkspace = resolve(localWorkspace);
    this.remoteWorkspace = posix.normalize(remoteWorkspace);
    if (!isAbsolute(this.localWorkspace)) throw new Error("localWorkspace must be an absolute local path");
    if (!posix.isAbsolute(this.remoteWorkspace)) {
      throw new Error(`remoteWorkspace must be an absolute POSIX path: ${remoteWorkspace}`);
    }
  }
  toRemotePath(input, cwd) {
    if (input.trim().length === 0) throw new Error("path must be a non-empty string");
    if (input.startsWith("file:")) return posixPathFromFileUri(input);
    const localAbsolute = isAbsolute(input);
    if (localAbsolute) {
      const rel = relative(this.localWorkspace, resolve(input));
      if (rel === "" || rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) {
        return posix.resolve(this.remoteWorkspace, rel.split(sep).join("/"));
      }
      if (input.startsWith("/")) return posix.normalize(input);
      throw new Error(`local path is outside the Remote SSH workspace alias: ${input}`);
    }
    if (input.startsWith("/")) return posix.normalize(input);
    const base = cwd === void 0 ? this.remoteWorkspace : this.toRemotePath(cwd);
    return posix.resolve(base, input.replaceAll("\\", "/"));
  }
};
var RemoteSshRuntime = class extends Service {
  static Config = z.object({
    sshTarget: z.string().required(),
    remoteWorkspace: z.string(),
    localWorkspace: z.string(),
    remoteAccessRoot: z.string(),
    sshExecutable: z.string().default("ssh"),
    sshArgs: z.array(z.string()).default([]),
    remoteCodeCommand: z.string().default("code"),
    remoteRuntimeRoot: z.string().default("/tmp/dsh-remote-ssh"),
    startupTimeoutMs: z.number().default(6e5),
    requestTimeoutMs: z.number().default(3e4),
    protocolVersions: z.array(z.string()).default([...DSH_AHP_PROTOCOL_VERSIONS]),
    directUrl: z.string()
  });
  mapper;
  config;
  clientId = `dsh-remote-ssh-${randomUUID()}`;
  runtimeRoot;
  remoteAccessRoot;
  ready;
  tunnel;
  embeddedAgentHost;
  disposed = false;
  monitor = new ConnectionStatus();
  constructor(ctx, config) {
    super(ctx, "remoteSsh");
    this.config = config;
    if (config.localWorkspace === void 0 !== (config.remoteWorkspace === void 0)) {
      throw new Error("dsh-remote-ssh: localWorkspace and remoteWorkspace must be configured together");
    }
    this.mapper = config.localWorkspace === void 0 || config.remoteWorkspace === void 0 ? void 0 : new WorkspacePathMapper(config.localWorkspace, config.remoteWorkspace);
    this.remoteAccessRoot = posix.normalize(config.remoteAccessRoot ?? config.remoteWorkspace ?? "/");
    this.runtimeRoot = posix.join(this.config.remoteRuntimeRoot, this.clientId);
    this.validate();
    if (this.mapper !== void 0) mkdirSync(this.mapper.localWorkspace, { recursive: true });
    this.ready = this.open();
    void this.ready.catch(() => {
    });
    ctx.effect(() => async () => {
      this.disposed = true;
      this.monitor.disconnected();
      clearRemoteSandbox(this);
      try {
        const connection = await this.ready;
        await connection.client.resourceDelete({uri:fileUriFromPosixPath(this.runtimeRoot),recursive:true}).catch(()=>{});
        await connection.client.shutdown();
      } catch {
      } finally {
        this.tunnel?.kill();
        this.embeddedAgentHost?.kill();
      }
    }, "Remote SSH AHP teardown");
  }
  async getConnection() {
    if (this.disposed) throw new Error("Remote SSH service is disposing");
    this.ready ??= this.open();
    const pending = this.ready;
    try {
      let connection = await pending;
      if (connection.client.connectionState.status !== "connected" && this.ready === pending) {
        this.resetSshAttempt();
        this.ready = this.open();
        connection = await this.ready;
      }
      if (this.disposed) throw new Error("Remote SSH service is disposing");
      return connection;
    } catch (error) {
      if (!this.disposed) {this.ready = undefined;this.resetSshAttempt();}
      throw error;
    }
  }
  async getClient() {
    return (await this.getConnection()).client;
  }
  /** Workspace mapper for the legacy single-workspace providers. */
  getMapper() {
    if (this.mapper === void 0) throw new Error("dsh-remote-ssh: this shared host runtime has no default workspace mapper");
    return this.mapper;
  }
  validate() {
    const { sshTarget, sshExecutable, remoteCodeCommand, remoteRuntimeRoot, startupTimeoutMs, requestTimeoutMs, protocolVersions } = this.config;
    if (sshTarget.trim().length === 0 && this.config.directUrl === void 0) {
      throw new Error("dsh-remote-ssh: sshTarget must be non-empty");
    }
    if (sshExecutable.trim().length === 0) throw new Error("dsh-remote-ssh: sshExecutable must be non-empty");
    if (remoteCodeCommand.trim().length === 0) throw new Error("dsh-remote-ssh: remoteCodeCommand must be non-empty");
    if (!posix.isAbsolute(remoteRuntimeRoot)) throw new Error("dsh-remote-ssh: remoteRuntimeRoot must be an absolute POSIX path");
    if (!posix.isAbsolute(this.remoteAccessRoot)) throw new Error("dsh-remote-ssh: remoteAccessRoot must be an absolute POSIX path");
    if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs <= 0) {
      throw new Error("dsh-remote-ssh: startupTimeoutMs must be a positive integer");
    }
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new Error("dsh-remote-ssh: requestTimeoutMs must be a positive integer");
    }
    if (protocolVersions.length === 0 || protocolVersions.some((version) => version.trim().length === 0)) {
      throw new Error("dsh-remote-ssh: protocolVersions must contain non-empty versions");
    }
  }
  async open() {
    this.monitor.connecting();
    try {
      const connection=await (this.config.directUrl !== void 0 ? this.connectEndpoint(this.config.directUrl) : this.openOverSsh());
      if(!this.disposed)this.monitor.connected(connection,fileUriFromPosixPath(this.remoteAccessRoot));
      return connection;
    } catch(error){this.monitor.disconnected();throw error;}
  }
  async connectEndpoint(url) {
    const transport = await WebSocketTransport.connect(url);
    const client = new AhpClient(transport, { requestTimeoutMs: this.config.requestTimeoutMs });
    client.connect();
    try {
      const initialized = await client.initialize({
        clientId: this.clientId,
        protocolVersions: this.config.protocolVersions,
        initialSubscriptions: ["ahp-root://"]
      });
      const remoteUri = fileUriFromPosixPath(this.remoteAccessRoot);
      await client.resourceRequest({ uri: remoteUri, read: true, write: true });
      const runtimeUri = fileUriFromPosixPath(this.runtimeRoot);
      await client.resourceRequest({ uri: fileUriFromPosixPath(this.config.remoteRuntimeRoot), read: true, write: true });
      await client.resourceMkdir({ uri: runtimeUri });
      return {
        client,
        protocolVersion: initialized.protocolVersion,
        ...initialized.defaultDirectory !== void 0 ? { defaultDirectory: initialized.defaultDirectory } : {}
      };
    } catch (error) {
      await client.shutdown().catch(() => {
      });
      throw error;
    }
  }
  async openOverSsh() {
    const diagnostics = [];
    const startupCommand = buildRemoteAgentHostCommand(this.config.remoteCodeCommand);
    let startup;
    try {
      startup = await runCaptured(
        this.config.sshExecutable,
        [...this.config.sshArgs, "-T", this.config.sshTarget, startupCommand],
        this.config.startupTimeoutMs
      );
    } catch (error) {
      if (this.config.remoteCodeCommand !== "code") throw error;
      diagnostics.push(`standalone CLI: ${errorMessage(error)}`);
      startup = { exitCode: null, stdout: "", stderr: "" };
    }
    const clean = stripAnsi(`${startup.stdout}
${startup.stderr}`);
    const endpoint = /ws:\/\/(?:localhost|127\.0\.0\.1):(\d+)\?tkn=([^\s]+)/.exec(clean);
    if (endpoint?.[1] !== void 0 && endpoint[2] !== void 0) {
      try {
        const url = await this.openTunnel(Number(endpoint[1]), endpoint[2]);
        return await this.connectEndpoint(url);
      } catch (error) {
        this.resetSshAttempt();
        diagnostics.push(`standalone CLI: ${connectionDiagnostic(error, this.config.protocolVersions)}`);
        if (this.config.remoteCodeCommand !== "code") {
          throw new Error(`dsh-remote-ssh: configured VS Code Agent Host failed
${diagnostics.at(-1)}`, { cause: error });
        }
      }
    } else if (clean.trim().length > 0) {
      diagnostics.push(`standalone CLI (ssh exit ${startup.exitCode ?? "unknown"}): ${tailDiagnostic(clean)}`);
    }
    if (this.config.remoteCodeCommand !== "code") {
      throw new Error(`dsh-remote-ssh: remote VS Code Agent Host failed to start (ssh exit ${startup.exitCode})
${clean}`);
    }
    const candidates = await this.listEmbeddedAgentHosts();
    for (const [index, codeServerPath] of candidates.entries()) {
      try {
        const url = await this.startEmbeddedAgentHost(codeServerPath, index);
        return await this.connectEndpoint(url);
      } catch (error) {
        this.resetSshAttempt();
        diagnostics.push(`embedded ${codeServerPath}: ${connectionDiagnostic(error, this.config.protocolVersions)}`);
      }
    }
    if (candidates.length === 0) diagnostics.push("embedded VS Code Server: no installed code-server found");
    throw new Error(`dsh-remote-ssh: no compatible VS Code Agent Host found
${diagnostics.join("\n")}`);
  }
  async listEmbeddedAgentHosts() {
    const result = await runCaptured(
      this.config.sshExecutable,
      [...this.config.sshArgs, "-T", this.config.sshTarget, buildListEmbeddedAgentHostsCommand()],
      Math.min(this.config.startupTimeoutMs, 3e4)
    );
    if (result.exitCode !== 0) return [];
    return [...new Set(result.stdout.split(/\r?\n/u).map((path) => path.trim()).filter(Boolean))];
  }
  async startEmbeddedAgentHost(codeServerPath, attempt) {
    const instanceId = `${this.clientId}-${attempt}`;
    const child = spawn(this.config.sshExecutable, [
      ...this.config.sshArgs,
      "-T",
      this.config.sshTarget,
      buildEmbeddedAgentHostCommand(codeServerPath, instanceId)
    ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.embeddedAgentHost = child;
    let remotePort;
    try {
      remotePort = await waitForAgentHostPort(child, this.config.startupTimeoutMs);
    } catch (error) {
      child.kill();
      throw error;
    }
    const tokenResult = await runCaptured(
      this.config.sshExecutable,
      [...this.config.sshArgs, "-T", this.config.sshTarget, `cat "$HOME/.dsh-ssh-workspace/server-embedded/${instanceId}/data/token"`],
      Math.min(this.config.startupTimeoutMs, 3e4)
    );
    const token = tokenResult.stdout.trim();
    if (tokenResult.exitCode !== 0 || token.length === 0 || /\s/.test(token)) {
      child.kill();
      throw new Error(`dsh-remote-ssh: could not read the embedded Agent Host connection token
${tokenResult.stderr}`);
    }
    return this.openTunnel(remotePort, token);
  }
  async openTunnel(remotePort, token) {
    const localPort = await reservePort();
    const tunnel = spawn(this.config.sshExecutable, [
      ...this.config.sshArgs,
      "-T",
      "-N",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      "-L",
      `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
      this.config.sshTarget
    ], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.tunnel = tunnel;
    await waitForPort(localPort, tunnel, 15e3);
    return `ws://127.0.0.1:${localPort}?tkn=${encodeURIComponent(token)}`;
  }
  resetSshAttempt() {
    this.tunnel?.kill();
    this.tunnel = void 0;
    this.embeddedAgentHost?.kill();
    this.embeddedAgentHost = void 0;
  }
};
async function runCaptured(command, args, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let size = 0;
    const append = (bucket, chunk) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        child.kill();
        reject(new Error("dsh-remote-ssh: SSH startup output exceeded 4 MiB"));
        return;
      }
      bucket.push(chunk);
    };
    child.stdout.on("data", (chunk) => {
      append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      append(stderr, chunk);
    });
    child.once("error", reject);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`dsh-remote-ssh: SSH startup timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}
async function waitForAgentHostPort(child, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    let output = "";
    let settled = false;
    const finish = (operation) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      operation();
    };
    const append = (chunk) => {
      output += chunk.toString("utf8");
      if (Buffer.byteLength(output, "utf8") > 4 * 1024 * 1024) {
        finish(() => reject(new Error("embedded Agent Host startup output exceeded 4 MiB")));
        return;
      }
      const match = /Agent host server listening on (?:localhost|127\.0\.0\.1):(\d+)/.exec(stripAnsi(output));
      if (match?.[1] !== void 0) finish(() => resolvePromise(Number(match[1])));
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", (error) => {
      finish(() => reject(error));
    });
    child.once("close", (code) => {
      finish(() => reject(new Error(`embedded Agent Host SSH process exited with code ${code}
${stripAnsi(output)}`)));
    });
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`embedded Agent Host startup timed out after ${timeoutMs}ms
${stripAnsi(output)}`)));
    }, timeoutMs);
  });
}
function stripAnsi(value) {
  return value.replace(/\x1B(?:[@-_][0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, "");
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function tailDiagnostic(value, maxLength = 2e3) {
  const clean = stripAnsi(value).trim();
  return clean.length <= maxLength ? clean : `\u2026${clean.slice(-maxLength)}`;
}
function connectionDiagnostic(error, offeredVersions) {
  const mismatch = ahpProtocolMismatch(error, offeredVersions);
  return mismatch === void 0 ? tailDiagnostic(errorMessage(error)) : `AHP protocol mismatch: ${formatAhpProtocolMismatch(mismatch)}`;
}
async function reservePort() {
  const server = createServer();
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("dsh-remote-ssh: failed to reserve a TCP port"));
        return;
      }
      const port = address.port;
      server.close((error) => error === void 0 ? resolvePromise(port) : reject(error));
    });
  });
}
async function waitForPort(port, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`dsh-remote-ssh: SSH tunnel exited with code ${child.exitCode}`);
    const connected = await new Promise((resolvePromise) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolvePromise(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolvePromise(false);
      });
    });
    if (connected) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  child.kill();
  throw new Error(`dsh-remote-ssh: SSH tunnel did not open port ${port} within ${timeoutMs}ms`);
}
var runtime_default = RemoteSshRuntime;

// .tmp/provider/src/transport/fs.ts
var BASE64 = "base64";
var UTF8 = "utf-8";
var RemoteSshFileSystem = class extends FileSystem {
  static inject = ["remoteSsh"];
  static Config = z2.object({
    diffBasisMaxBytes: z2.number().default(10 * 1024 * 1024),
    maxReadBytes: z2.number().default(64 * 1024 * 1024),
    localWorkspace: z2.string(),
    remoteWorkspace: z2.string()
  });
  config;
  remote;
  mapper;
  locks = /* @__PURE__ */ new Map();
  constructor(ctx, config) {
    super(ctx);
    this.remote = ctx.remoteSsh;
    this.config = config;
    if (config.localWorkspace === void 0 !== (config.remoteWorkspace === void 0)) {
      throw new Error("dsh-remote-ssh/fs: localWorkspace and remoteWorkspace must be configured together");
    }
    this.mapper = config.localWorkspace !== void 0 && config.remoteWorkspace !== void 0 ? new WorkspacePathMapper(config.localWorkspace, config.remoteWorkspace) : requireRuntimeMapper(this.remote);
    for (const [name, value] of Object.entries({ diffBasisMaxBytes: this.config.diffBasisMaxBytes, maxReadBytes: this.config.maxReadBytes })) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`dsh-remote-ssh/fs: ${name} must be a positive integer`);
      }
    }
  }
  async resolve(path, opts) {
    throwIfAborted(opts?.signal, "resolve");
    let candidate;
    try {
      candidate = this.mapper.toRemotePath(path, opts?.cwd);
    } catch (error) {
      throw new FsError(errorMessage2(error), "FS_NOT_FOUND", { cause: error });
    }
    const missing = [];
    let cursor = candidate;
    for (; ; ) {
      throwIfAborted(opts?.signal, "resolve");
      try {
        const resolved = await this.resolveUri(fileUriFromPosixPath(cursor), true);
        const canonical = posixPathFromFileUri(resolved.uri);
        const remotePath = missing.reduceRight((base, part) => posix2.join(base, part), canonical);
        return this.target(remotePath);
      } catch (error) {
        if (!isNotFound(error)) throw mapFsError("resolve", candidate, error);
        const parent = posix2.dirname(cursor);
        if (parent === cursor) throw mapFsError("resolve", candidate, error);
        missing.push(posix2.basename(cursor));
        cursor = parent;
      }
    }
  }
  processPath(target) {
    return posixPathFromFileUri(String(target.targetKey));
  }
  fileUrl(target) {
    return String(target.targetKey);
  }
  contains(parent, child) {
    const rel = posix2.relative(this.processPath(parent), this.processPath(child));
    return rel === "" || rel !== ".." && !rel.startsWith("../") && !posix2.isAbsolute(rel);
  }
  async stat(target, signal) {
    throwIfAborted(signal, "stat");
    const probe = await this.probe(target, true);
    throwIfAborted(signal, "stat");
    if (probe === void 0) return void 0;
    return {
      version: probe.version,
      type: resourceType(probe.resolved.type),
      ...probe.resolved.size !== void 0 ? { size: probe.resolved.size } : {}
    };
  }
  async lstat(path, opts, signal) {
    throwIfAborted(signal, "lstat");
    let remotePath;
    try {
      remotePath = this.mapper.toRemotePath(path, opts?.cwd);
    } catch (error) {
      throw new FsError(errorMessage2(error), "FS_NOT_FOUND", { cause: error });
    }
    try {
      const resolved = await this.resolveUri(fileUriFromPosixPath(remotePath), false);
      throwIfAborted(signal, "lstat");
      return {
        version: versionOf(resolved),
        type: resolved.type === "symlink" ? "symlink" : resourceType(resolved.type),
        ...resolved.size !== void 0 ? { size: resolved.size } : {}
      };
    } catch (error) {
      if (isNotFound(error)) return void 0;
      throw mapFsError("lstat", remotePath, error);
    }
  }
  async readText(target, signal) {
    const bytes = await this.readBytes(target, signal, this.config.maxReadBytes);
    return decodeText(bytes, target.displayPath);
  }
  async streamText(target, signal) {
    const text = await this.readText(target, signal);
    return (async function* () {
      let offset = 0;
      while (offset < text.length) {
        throwIfAborted(signal, "read");
        let end = Math.min(text.length, offset + 64 * 1024);
        if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1] ?? "")) end -= 1;
        yield text.slice(offset, end);
        offset = end;
      }
    })();
  }
  async readBytes(target, signal, maxBytes) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new FsError("maxBytes must be a non-negative integer", "FS_TOO_LARGE");
    throwIfAborted(signal, "read");
    const info = await this.stat(target, signal);
    if (info === void 0) throw new FsError(`cannot read "${target.displayPath}": file not found`, "FS_NOT_FOUND");
    if (info.type !== "file") throw new FsError(`cannot read "${target.displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE");
    if (info.size !== void 0 && info.size > maxBytes) {
      throw new FsError(`cannot read "${target.displayPath}": file exceeds ${maxBytes} bytes`, "FS_TOO_LARGE");
    }
    try {
      const client = await this.remote.getClient();
      const result = await client.resourceRead({ uri: this.fileUrl(target), encoding: BASE64 });
      throwIfAborted(signal, "read");
      const bytes = result.encoding === BASE64 ? Buffer.from(result.data, "base64") : Buffer.from(result.data, "utf8");
      if (bytes.length > maxBytes) {
        throw new FsError(`cannot read "${target.displayPath}": file exceeds ${maxBytes} bytes`, "FS_TOO_LARGE");
      }
      return bytes;
    } catch (error) {
      if (error instanceof FsError) throw error;
      throw mapFsError("read", target.displayPath, error);
    }
  }
  async listDir(target, signal) {
    throwIfAborted(signal, "list");
    try {
      const client = await this.remote.getClient();
      const listed = await client.resourceList({ uri: this.fileUrl(target) });
      const entries = [];
      for (const entry of listed.entries.sort((a, b) => a.name.localeCompare(b.name))) {
        throwIfAborted(signal, "list");
        const child = await this.resolve(posix2.join(this.processPath(target), entry.name), signal === void 0 ? void 0 : { signal });
        const info = await this.stat(child, signal);
        entries.push({
          name: entry.name,
          type: info?.type ?? entry.type,
          target: child,
          ...info?.version !== void 0 ? { version: info.version } : {},
          ...info?.size !== void 0 ? { size: info.size } : {}
        });
      }
      return entries;
    } catch (error) {
      if (error instanceof FsError) throw error;
      throw mapFsError("list", target.displayPath, error);
    }
  }
  async writeText(target, content, expected, signal, sandboxPolicy) {
    await assertMutationAllowed(this.remote, this.mapper, target, sandboxPolicy);
    return this.withLock(String(target.targetKey), async () => {
      throwIfAborted(signal, "write");
      const existing = await this.probe(target, true);
      if (existing !== void 0 && resourceType(existing.resolved.type) !== "file") {
        throw new FsError(`cannot write "${target.displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE");
      }
      if (expected?.kind === "replaceIfVersion") {
        if (existing === void 0 || existing.version !== expected.version) {
          throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, "FS_STALE_VERSION");
        }
      } else if (expected?.kind === "createIfAbsent" && existing !== void 0) {
        throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, "FS_NOT_OBSERVED");
      }
      let before = null;
      if (existing !== void 0 && (existing.resolved.size ?? this.config.diffBasisMaxBytes) < this.config.diffBasisMaxBytes && Buffer.byteLength(content, "utf8") < this.config.diffBasisMaxBytes) {
        try {
          before = normalizeLineEndings(await this.readText(target, signal));
        } catch {
          before = null;
        }
      }
      try {
        const client = await this.remote.getClient();
        await client.resourceWrite({
          uri: this.fileUrl(target),
          data: content,
          encoding: UTF8,
          contentType: "text/plain; charset=utf-8",
          ...expected?.kind === "createIfAbsent" ? { createOnly: true } : {},
          ...expected?.kind === "replaceIfVersion" && existing?.resolved.etag !== void 0 ? { ifMatch: existing.resolved.etag } : {}
        });
      } catch (error) {
        if (error instanceof RpcError2 && error.code === AhpErrorCodes2.AlreadyExists) {
          throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, "FS_NOT_OBSERVED", { cause: error });
        }
        throw mapFsError("write", target.displayPath, error);
      }
      throwIfAborted(signal, "write");
      const after = await this.probe(target, true);
      if (after === void 0) throw new FsError(`write did not publish "${target.displayPath}"`, "FS_IO_ERROR");
      return {
        operation: existing === void 0 ? "create" : "update",
        version: after.version,
        before,
        after: normalizeLineEndings(content)
      };
    });
  }
  async writeBytes(target, content, expected, signal, sandboxPolicy) {
    await assertMutationAllowed(this.remote, this.mapper, target, sandboxPolicy);
    return this.withLock(String(target.targetKey), async () => {
      throwIfAborted(signal, "write");
      const existing = await this.probe(target, true);
      if (existing !== void 0 && resourceType(existing.resolved.type) !== "file") {
        throw new FsError(`cannot write "${target.displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE");
      }
      if (expected?.kind === "replaceIfVersion") {
        if (existing === void 0 || existing.version !== expected.version) {
          throw new FsError(`cannot write "${target.displayPath}": file changed since it was read`, "FS_STALE_VERSION");
        }
      } else if (expected?.kind === "createIfAbsent" && existing !== void 0) {
        throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, "FS_NOT_OBSERVED");
      }
      try {
        const client = await this.remote.getClient();
        await client.resourceWrite({
          uri: this.fileUrl(target),
          data: Buffer.from(content).toString("base64"),
          encoding: BASE64,
          contentType: "application/octet-stream",
          ...expected?.kind === "createIfAbsent" ? { createOnly: true } : {},
          ...expected?.kind === "replaceIfVersion" && existing?.resolved.etag !== void 0 ? { ifMatch: existing.resolved.etag } : {}
        });
      } catch (error) {
        if (error instanceof RpcError2 && error.code === AhpErrorCodes2.AlreadyExists) {
          throw new FsError(`cannot overwrite existing "${target.displayPath}" without reading it first`, "FS_NOT_OBSERVED", { cause: error });
        }
        throw mapFsError("write", target.displayPath, error);
      }
      throwIfAborted(signal, "write");
      const after = await this.probe(target, true);
      if (after === void 0) throw new FsError(`write did not publish "${target.displayPath}"`, "FS_IO_ERROR");
      return {
        operation: existing === void 0 ? "create" : "update",
        version: after.version,
        bytes: content.byteLength
      };
    });
  }
  async editText(target, edit, expected, signal, sandboxPolicy) {
    await assertMutationAllowed(this.remote, this.mapper, target, sandboxPolicy);
    return this.withLock(String(target.targetKey), async () => {
      throwIfAborted(signal, "edit");
      const existing = await this.probe(target, true);
      if (existing === void 0 || expected !== void 0 && existing.version !== expected.version) {
        throw new FsError(`cannot edit "${target.displayPath}": file changed since it was read`, "FS_STALE_VERSION");
      }
      if (resourceType(existing.resolved.type) !== "file") {
        throw new FsError(`cannot edit "${target.displayPath}": not a regular file`, "FS_NOT_REGULAR_FILE");
      }
      const stored = await this.readText(target, signal);
      const before = normalizeLineEndings(stored);
      const oldString = normalizeLineEndings(edit.oldString);
      if (oldString.length === 0) throw new FsError("old_string must be non-empty", "FS_EDIT_NOT_FOUND");
      const count = countOccurrences(before, oldString);
      if (count === 0) throw new FsError(`old_string was not found in "${target.displayPath}"`, "FS_EDIT_NOT_FOUND");
      if (!edit.replaceAll && count !== 1) {
        throw new FsError(`old_string appears ${count} times in "${target.displayPath}"`, "FS_AMBIGUOUS_EDIT");
      }
      const normalizedAfter = edit.replaceAll ? before.split(oldString).join(normalizeLineEndings(edit.newString)) : before.replace(oldString, normalizeLineEndings(edit.newString));
      const afterStorage = usesCrlf(stored) ? normalizedAfter.replaceAll("\n", "\r\n") : normalizedAfter;
      try {
        const client = await this.remote.getClient();
        await client.resourceWrite({
          uri: this.fileUrl(target),
          data: afterStorage,
          encoding: UTF8,
          contentType: "text/plain; charset=utf-8",
          ...existing.resolved.etag !== void 0 ? { ifMatch: existing.resolved.etag } : {}
        });
      } catch (error) {
        throw mapFsError("edit", target.displayPath, error);
      }
      throwIfAborted(signal, "edit");
      const afterProbe = await this.probe(target, true);
      if (afterProbe === void 0) throw new FsError(`edit did not publish "${target.displayPath}"`, "FS_IO_ERROR");
      return { version: afterProbe.version, before, after: normalizedAfter };
    });
  }
  target(remotePath) {
    const uri = fileUriFromPosixPath(remotePath);
    return {
      targetKey: FsTargetKey(uri),
      displayPath: posix2.normalize(remotePath)
    };
  }
  async resolveUri(uri, followSymlinks) {
    const client = await this.remote.getClient();
    return client.resourceResolve({ uri, followSymlinks });
  }
  async probe(target, followSymlinks) {
    try {
      const resolved = await this.resolveUri(this.fileUrl(target), followSymlinks);
      return { resolved, version: versionOf(resolved) };
    } catch (error) {
      if (isNotFound(error)) return void 0;
      throw mapFsError("stat", target.displayPath, error);
    }
  }
  async withLock(key, operation) {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.then(operation, operation);
    const tail = run.then(() => void 0, () => void 0);
    this.locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }
};
async function assertMutationAllowed(remote, mapper, target, policy) {
  if (policy === void 0 || policy.mode === "danger-full-access") return;
  if (policy.mode === "read-only") {
    throw new FsError(`remote mutation denied for "${target.displayPath}" by read-only mode`, "FS_SANDBOX_DENIED");
  }
  const roots=await remoteWritableRoots(remote,mapper,policy);
  const path = posixPathFromFileUri(String(target.targetKey));
  if (!roots.some(root => {const rel=posix2.relative(root,path);return rel==="" || rel!==".."&&!rel.startsWith("../")&&!posix2.isAbsolute(rel);})) {
    throw new FsError(`remote mutation denied outside workspace: "${target.displayPath}"`, "FS_SANDBOX_DENIED");
  }
}
function requireRuntimeMapper(remote) {
  if (remote.mapper !== void 0) return remote.mapper;
  try {
    return remote.getMapper();
  } catch (error) {
    throw new Error("dsh-remote-ssh/fs: a workspace mapping is required when the shared host runtime has no default mapper", { cause: error });
  }
}
function versionOf(result) {
  return FsVersion(result.etag ?? JSON.stringify([result.uri, result.type, result.size, result.mtime, result.ctime]));
}
function resourceType(type) {
  if (type === "file") return "file";
  if (type === "directory") return "directory";
  return "other";
}
function isNotFound(error) {
  return error instanceof RpcError2 && error.code === AhpErrorCodes2.NotFound;
}
function mapFsError(operation, path, error) {
  if (error instanceof FsError) return error;
  if (error instanceof RpcError2) {
    if (error.code === AhpErrorCodes2.NotFound) return new FsError(`${operation} failed for "${path}": not found`, "FS_NOT_FOUND", { cause: error });
    if (error.code === AhpErrorCodes2.PermissionDenied) return new FsError(`${operation} denied for "${path}"`, "FS_PERMISSION_DENIED", { cause: error });
    if (error.code === AhpErrorCodes2.Conflict) return new FsError(`${operation} failed for "${path}": file changed`, "FS_STALE_VERSION", { cause: error });
  }
  return new FsError(`${operation} failed for "${path}": ${errorMessage2(error)}`, "FS_IO_ERROR", { cause: error });
}
function throwIfAborted(signal, operation) {
  if (signal?.aborted) throw new FsError(`${operation} aborted`, "FS_ABORTED", { cause: signal.reason });
}
function decodeText(bytes, path) {
  if (bytes.includes(0)) throw new FsError(`cannot read "${path}": file contains NUL bytes`, "FS_NOT_TEXT");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new FsError(`cannot read "${path}": file is not valid UTF-8`, "FS_NOT_TEXT", { cause: error });
  }
}
function normalizeLineEndings(value) {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}
function usesCrlf(value) {
  return value.includes("\r\n") && !value.replaceAll("\r\n", "").includes("\n");
}
function countOccurrences(haystack, needle) {
  let count = 0;
  let offset = 0;
  while ((offset = haystack.indexOf(needle, offset)) !== -1) {
    count += 1;
    offset += needle.length;
  }
  return count;
}
function errorMessage2(error) {
  return error instanceof Error ? error.message : String(error);
}
var fs_default = RemoteSshFileSystem;

// .tmp/provider/src/transport/shell.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { posix as posix3 } from "node:path";
import { ActionType } from "@microsoft/agent-host-protocol";
import { ShellExecutor } from "@deepseek-ai/dsh-shell";
import z3 from "@deepseek-ai/schemastery";
var UTF82 = "utf-8";
var RemoteSshShellExecutor = class extends ShellExecutor {
  static inject = ["remoteSsh"];
  static Config = z3.object({
    defaultTimeoutMs: z3.number().default(12e4),
    maxTimeoutMs: z3.number().default(6e5),
    outputMaxBytes: z3.number().default(256 * 1024),
    maxOutputMaxBytes: z3.number().default(16 * 1024 * 1024),
    shellCommand: z3.string().default("bash"),
    localWorkspace: z3.string(),
    remoteWorkspace: z3.string()
  });
  config;
  remote;
  mapper;
  processes = /* @__PURE__ */ new Set();
  constructor(ctx, config) {
    super(ctx);
    this.remote = ctx.remoteSsh;
    this.config = config;
    if (config.localWorkspace === void 0 !== (config.remoteWorkspace === void 0)) {
      throw new Error("dsh-remote-ssh/shell: localWorkspace and remoteWorkspace must be configured together");
    }
    this.mapper = config.localWorkspace !== void 0 && config.remoteWorkspace !== void 0 ? new WorkspacePathMapper(config.localWorkspace, config.remoteWorkspace) : mapperOf(this.remote);
    this.validate();
    ctx.effect(() => async () => {
      for (const process2 of this.processes) process2.kill();
      await Promise.allSettled([...this.processes].map((process2) => process2.done));
    }, "Remote SSH shell teardown");
  }
  resolve(request) {
    const timeoutMs = clampPositive(request.timeoutMs ?? this.config.defaultTimeoutMs, this.config.maxTimeoutMs, "timeoutMs");
    const stdoutMaxBytes = clampPositive(request.stdoutMaxBytes ?? this.config.outputMaxBytes, this.config.maxOutputMaxBytes, "stdoutMaxBytes");
    return {
      command: request.command,
      workdir: request.workdir ?? this.mapper.localWorkspace,
      timeoutMs,
      stdoutMaxBytes,
      signal: request.signal,
      stdin: request.stdin,
      env: request.env,
      dshEnv: request.dshEnv,
      sandboxPolicy: request.sandboxPolicy
    };
  }
  async run(spec) {
    const outcome = await executeTerminal(this.remote, this.mapper, this.config.shellCommand, spec, spec.stdoutMaxBytes, spec.timeoutMs);
    return {
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut: outcome.timedOut,
      aborted: outcome.aborted,
      timeoutMs: spec.timeoutMs,
      stdout: outcome.output.collected(),
      stderr: { text: "", truncated: false },
      sandbox: outcome.sandbox
    };
  }
  async execute(spec) {
    const process2 = new AhpShellProcess(this.remote, this.mapper, this.config.shellCommand, spec, spec.stdoutMaxBytes, spec.onExpiry === "none" ? 0 : spec.timeoutMs);
    this.processes.add(process2);
    void process2.done.then(() => this.processes.delete(process2));
    return process2;
  }
  start(spec) {
    const process2 = new AhpShellProcess(this.remote, this.mapper, this.config.shellCommand, spec, this.config.outputMaxBytes);
    this.processes.add(process2);
    void process2.done.finally(() => {
      this.processes.delete(process2);
    });
    return process2;
  }
  validate() {
    for (const name of ["defaultTimeoutMs", "maxTimeoutMs", "outputMaxBytes", "maxOutputMaxBytes"]) {
      const value = this.config[name];
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`dsh-remote-ssh/shell: ${name} must be a positive integer`);
    }
    if (this.config.defaultTimeoutMs > this.config.maxTimeoutMs) throw new Error("dsh-remote-ssh/shell: defaultTimeoutMs exceeds maxTimeoutMs");
    if (this.config.outputMaxBytes > this.config.maxOutputMaxBytes) throw new Error("dsh-remote-ssh/shell: outputMaxBytes exceeds maxOutputMaxBytes");
    if (this.config.shellCommand.trim().length === 0) throw new Error("dsh-remote-ssh/shell: shellCommand must be non-empty");
  }
};
var AhpShellProcess = class {
  status = "running";
  exitCode = null;
  signal = null;
  done;
  controller = new AbortController();
  output;
  constructor(remote, mapper, shellCommand, spec, outputMaxBytes, timeoutMs = 0) {
    this.spec = spec;
    this.output = new TailBuffer(outputMaxBytes);
    this.observed = {stdout:{readFrom:offset => this.output.readFrom(offset)},stderr:{readFrom:offset => ({text:"",nextOffset:offset,lossy:false})}};
    this.done = executeTerminal(remote, mapper, shellCommand, { ...spec, signal: combineSignals(spec.signal, this.controller.signal) }, outputMaxBytes, timeoutMs, this.output).then((outcome) => {
      this.outcome = outcome;
      this.exitCode = outcome.exitCode;
      this.signal = outcome.signal;
      this.status = outcome.signal === null ? "completed" : "killed";
    }, (error) => {
      this.error = error;
      this.output.append(`
[dsh-remote-ssh infrastructure error] ${errorMessage3(error)}
`);
      this.exitCode = null;
      this.signal = "SIGTERM";
      this.status = "killed";
    });
  }
  result() {
    return this.done.then(() => {
      if (this.error) throw this.error;
      return {exitCode:this.exitCode,signal:this.signal,timedOut:this.outcome.timedOut,aborted:this.outcome.aborted,timeoutMs:this.spec.timeoutMs,stdout:this.output.collected(),stderr:{text:"",truncated:false},sandbox:this.outcome.sandbox};
    });
  }
  readOutput() {
    return this.output.readIncremental();
  }
  kill() {
    if (this.status !== "running" || this.controller.signal.aborted) return false;
    this.controller.abort(new Error("background process killed"));
    return true;
  }
};
async function executeTerminal(remote, mapper, shellCommand, spec, outputMaxBytes, timeoutMs, existingOutput) {
  const output = existingOutput ?? new TailBuffer(outputMaxBytes);
  spec.signal?.throwIfAborted();
  const client = await remote.getClient();
  spec.signal?.throwIfAborted();
  const token = randomUUID2();
  const terminalUri = `ahp-terminal:/${token}`;
  const commandPath = posix3.join(remote.runtimeRoot, `command-${token}.sh`);
  const stdinPath = posix3.join(remote.runtimeRoot, `stdin-${token}.bin`);
  const commandUri = fileUriFromPosixPath(commandPath);
  const stdinUri = fileUriFromPosixPath(stdinPath);
  const workdir = mapper.toRemotePath(spec.workdir);
  const confinement = await wrapRemoteArgv(remote,mapper,spec.sandboxPolicy,[shellCommand,commandPath]);
  const finish = outcome => ({...outcome,sandbox:sandboxOutcome(confinement,outcome.exitCode,output.collected().text)});
  let subscription;
  let terminalCreated = false;
  let stdinCreated = false;
  let timer;
  let abortListener;
  let stopCause;
  let resolveStop;
  const stopped = new Promise((resolvePromise) => {
    resolveStop = resolvePromise;
  });
  const stop = (cause) => {
    if (stopCause !== void 0) return;
    stopCause = cause;
    resolveStop?.(cause);
  };
  try {
    if (spec.signal?.aborted) stop("abort");
    await client.resourceWrite({ uri: commandUri, data: spec.command, encoding: UTF82, contentType: "text/x-shellscript" });
    if (spec.stdin !== void 0) {
      await client.resourceWrite({ uri: stdinUri, data: Buffer.from(spec.stdin).toString("base64"), encoding: "base64" });
      stdinCreated = true;
    }
    const claim = { kind: "client", clientId: remote.clientId };
    await client.request("createTerminal", {
      channel: terminalUri,
      claim,
      name: "DeepSeek Harness Remote SSH",
      cwd: fileUriFromPosixPath(workdir),
      cols: 120,
      rows: 30
    });
    terminalCreated = true;
    const subscribed = await client.subscribe(terminalUri);
    subscription = subscribed.subscription;
    if (timeoutMs > 0) timer = setTimeout(() => {
      stop("timeout");
    }, timeoutMs);
    if (spec.signal !== void 0) {
      abortListener = () => {
        stop("abort");
      };
      spec.signal.addEventListener("abort", abortListener, { once: true });
    }
    const env = mergeEnvironment(mapper, spec);
    const envArgs = Object.entries(env).map(([key, value]) => `${key}=${quotePosix(value)}`).join(" ");
    const stdinRedirect = stdinCreated ? quotePosix(stdinPath) : "/dev/null";
    const marker = new TerminalOutputCapture(token, output);
    const input = `printf '\\036DSH:${token}:BEGIN\\037'; env ${envArgs} ${confinement.argv.map(quotePosix).join(" ")} < ${stdinRedirect}; __dsh_status=$?; printf '\\036DSH:${token}:END:%s\\037' "$__dsh_status"; exit "$__dsh_status"\r`;
    if(spec.signal?.aborted) {await client.request("disposeTerminal",{channel:terminalUri}).catch(()=>{});terminalCreated=false;return finish({exitCode:null,signal:"SIGTERM",timedOut:false,aborted:true,output});}
    client.dispatch(terminalUri, { type: ActionType.TerminalInput, data: input });
    let commandId;
    for (; ; ) {
      const eventOrStop = await Promise.race([
        subscription.next().then((result) => ({ kind: "event", result })),
        stopped.then((cause) => ({ kind: "stop", cause }))
      ]);
      if (eventOrStop.kind === "stop") {
        await client.request("disposeTerminal", { channel: terminalUri }).catch(() => {
        });
        terminalCreated = false;
        return finish({
          exitCode: null,
          signal: "SIGTERM",
          timedOut: eventOrStop.cause === "timeout",
          aborted: eventOrStop.cause === "abort",
          output
        });
      }
      if (eventOrStop.result.done) {
        throw new Error("Agent Host terminal subscription ended before command completion");
      }
      const event = eventOrStop.result.value;
      if (event.type !== "action") continue;
      const action = event.params.action;
      if (action.type === ActionType.TerminalCommandExecuted && commandId === void 0) {
        commandId = action.commandId;
      } else if (action.type === ActionType.TerminalData) {
        const exitCode = marker.push(action.data);
        if (exitCode !== void 0) {
          return finish({
            exitCode,
            signal: null,
            timedOut: false,
            aborted: false,
            output
          });
        }
      } else if (action.type === ActionType.TerminalCommandFinished && action.commandId === commandId && marker.started) {
        continue;
      } else if (action.type === ActionType.TerminalCommandFinished && commandId === void 0) {
        continue;
      } else if (action.type === ActionType.TerminalCommandFinished && action.commandId === commandId) {
        return finish({
          exitCode: action.exitCode ?? null,
          signal: null,
          timedOut: false,
          aborted: false,
          output
        });
      } else if (action.type === ActionType.TerminalExited) {
        if (!marker.finished) {
          throw new Error(`Agent Host terminal exited before the output marker (exit ${action.exitCode ?? "unknown"})`);
        }
        return finish({
          exitCode: action.exitCode ?? null,
          signal: action.exitCode === void 0 ? "SIGTERM" : null,
          timedOut: false,
          aborted: false,
          output
        });
      }
    }
  } finally {
    if (timer !== void 0) clearTimeout(timer);
    if (abortListener !== void 0) spec.signal?.removeEventListener("abort", abortListener);
    await subscription?.close().catch(() => {
    });
    if (terminalCreated) await client.request("disposeTerminal", { channel: terminalUri }).catch(() => {
    });
    await client.resourceDelete({ uri: commandUri }).catch(() => {
    });
    if (stdinCreated) await client.resourceDelete({ uri: stdinUri }).catch(() => {
    });
  }
}
var TerminalOutputCapture = class {
  constructor(token, output) {
    this.output = output;
    this.begin = `DSH:${token}:BEGIN`;
    this.endPrefix = `DSH:${token}:END:`;
  }
  output;
  begin;
  endPrefix;
  started = false;
  finished = false;
  pending = "";
  push(data) {
    if (this.finished) return void 0;
    this.pending += data;
    if (!this.started) {
      const at = this.pending.indexOf(this.begin);
      if (at === -1) {
        this.pending = this.pending.slice(-Math.max(0, this.begin.length - 1));
        return void 0;
      }
      this.started = true;
      this.pending = this.pending.slice(at + this.begin.length);
    }
    const end = this.pending.indexOf(this.endPrefix);
    if (end === -1) {
      const safe = Math.max(0, this.pending.length - (this.endPrefix.length - 1));
      if (safe > 0) {
        this.output.append(this.pending.slice(0, safe));
        this.pending = this.pending.slice(safe);
      }
      return void 0;
    }
    this.output.append(this.pending.slice(0, end));
    const statusStart = end + this.endPrefix.length;
    const terminator = this.pending.indexOf("", statusStart);
    if (terminator === -1) {
      this.pending = this.pending.slice(end);
      return void 0;
    }
    const raw = this.pending.slice(statusStart, terminator);
    if (!/^\d+$/.test(raw)) throw new Error(`Agent Host terminal emitted an invalid exit marker: ${JSON.stringify(raw)}`);
    this.finished = true;
    this.pending = "";
    return Number(raw);
  }
};
function mergeEnvironment(mapper, spec) {
  const result = { ...spec.env ?? {}, ...spec.dshEnv ?? {} };
  if (result.DSH_CWD !== void 0) result.DSH_CWD = mapper.toRemotePath(result.DSH_CWD);
  for (const key of Object.keys(result)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`invalid remote environment variable name: ${key}`);
    if (result[key]?.includes("\0")) throw new Error(`remote environment variable ${key} contains a NUL byte`);
  }
  return result;
}
var TailBuffer = class {
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
  }
  maxBytes;
  tail = Buffer.alloc(0);
  tailStart = 0;
  total = 0;
  readOffset = 0;
  append(value) {
    const chunk = Buffer.from(value);
    this.total += chunk.length;
    const combined = Buffer.concat([this.tail, chunk]);
    if (combined.length > this.maxBytes) {
      const dropped = combined.length - this.maxBytes;
      this.tail = combined.subarray(dropped);
      this.tailStart += dropped;
    } else {
      this.tail = combined;
    }
  }
  readFrom(offset) {
    const start = Math.max(offset, this.tailStart) - this.tailStart;
    return {text:this.tail.subarray(start).toString("utf8"),nextOffset:this.total,lossy:offset<this.tailStart};
  }
  collected() {
    return { text: this.tail.toString("utf8"), truncated: this.tailStart > 0 };
  }
  readIncremental() {
    const lossy = this.readOffset < this.tailStart;
    const start = Math.max(this.readOffset, this.tailStart) - this.tailStart;
    const delta = this.tail.subarray(start).toString("utf8");
    this.readOffset = this.total;
    return { delta, lossy };
  }
};
function clampPositive(value, max, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`dsh-remote-ssh/shell: ${name} must be positive`);
  return Math.min(Math.floor(value), max);
}
function combineSignals(first, second) {
  return first === void 0 ? second : AbortSignal.any([first, second]);
}
function errorMessage3(error) {
  return error instanceof Error ? error.message : String(error);
}
function mapperOf(remote) {
  return remote.mapper ?? remote.getMapper();
}
var shell_default = RemoteSshShellExecutor;

// .tmp/provider/src/routing/manager.ts
var DEFAULT_DSH_BACKEND_PORT = 9100;

var ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
var serverSchema = z4.object({
  id: z4.string().required(),
  label: z4.string().required(),
  sshTarget: z4.string().required(),
  sshArgs: z4.array(z4.string()),
  remoteCodeCommand: z4.string(),
  sshExecutable: z4.string(),
  backendPort: z4.number()
});
var workspaceSchema = z4.object({
  id: z4.string().required(),
  serverId: z4.string().required(),
  remotePath: z4.string().required(),
  aliasPath: z4.string(),
  title: z4.string(),
  registryWorkspaceId: z4.string()
});
var RemoteSshManager = class _RemoteSshManager extends Service2 {
  static inject = [];
  static Config = z4.object({
    aliasRoot: z4.string().default(resolve2(process.env.DSH_HOME ?? resolve2(process.env.USERPROFILE ?? ".", ".dsh"), "remote-ssh", "workspaces")),
    sshConfigFile: z4.string(),
    servers: z4.array(serverSchema).default([]),
    workspaces: z4.array(workspaceSchema).default([]),
    retiredAliases: z4.array(z4.string()).default([]),
    openFileMode: z4.union(["auto", "vscode", "cursor", "windsurf", "vscodium", "custom", "download"]).default("auto"),
    openFileEditorPath: z4.string(),
    openFileDownloadMaxBytes: z4.number().default(64 * 1024 * 1024),
    deletedWorkspaceAliases: z4.array(z4.string()).default([]),
    startupTimeoutMs: z4.number().default(6e5),
    requestTimeoutMs: z4.number().default(3e4)
  });
  entry;
  current;
  settings;
  routes = /* @__PURE__ */ new Map();
  routeByWorkspaceId = /* @__PURE__ */ new Map();
  remoteAliases = /* @__PURE__ */ new Set();
  contexts = /* @__PURE__ */ new Map();
  shellContexts = /* @__PURE__ */ new Map();
  hosts = /* @__PURE__ */ new Map();
  sessionWorlds = /* @__PURE__ */ new Map();
  workspaceRegistry;
  nativeWorkspaceIds = new Map();
  retiringAliases = new Set();
  retirementTail = Promise.resolve();
  refreshTail = Promise.resolve();
  initialRefresh;
  constructor(ctx, config) {
    super(ctx, "remoteSshManager");
    this.entry = config;
    this.current = this.entry;
    this.validate(this.entry);
    this.initialRefresh = this.loadCatalog();
    ctx.inject(["workspaceRegistry"], (workspaceCtx) => {
      this.workspaceRegistry = workspaceCtx.workspaceRegistry;
      this.nativeWorkspaceIds.clear();
      workspaceCtx.on("domain/changed", change => {
        if(change.domain!=="workspace" || change.table!=="workspaces")return;
        if(change.operation==="put" && change.value?.path){
          const route=this.findAlias(change.value.path);
          if(route && normalizeLocal(resolve2(change.value.path))===normalizeLocal(route.aliasPath))this.nativeWorkspaceIds.set(String(change.key),route.workspace.id);
        }
        if(change.operation==="deleted"){
          const id=this.nativeWorkspaceIds.get(String(change.key));
          if(id)void this.removeWorkspace(id,{native:false}).catch(error=>this.ctx.logger.error(error));
        }
      });
      void this.initialRefresh.then(()=>this.registerAllWorkspaces({reconcileMissing:true})).catch((error) => {
        this.ctx.logger.error(error);
      });
      workspaceCtx.effect(() => () => {
        if (this.workspaceRegistry === workspaceCtx.workspaceRegistry) this.workspaceRegistry = void 0;
      }, "Remote SSH workspace registry attachment");
    });
    ctx.effect(() => async () => {
      await this.retirementTail;
      await this.refreshTail;
      const contexts = await Promise.allSettled(this.contexts.values());
      await Promise.allSettled(contexts.flatMap((result) => result.status === "fulfilled" ? [result.value.ctx.fiber.dispose()] : []));
      this.contexts.clear();
      const shells = await Promise.allSettled(this.shellContexts.values());
      await Promise.allSettled(shells.flatMap((result) => result.status === "fulfilled" ? [result.value.ctx.fiber.dispose()] : []));
      this.shellContexts.clear();
      const hosts = await Promise.allSettled(this.hosts.values());
      await Promise.allSettled(hosts.flatMap((result) => result.status === "fulfilled" ? [this.disposeHost(result.value)] : []));
      this.hosts.clear();
    }, "Remote SSH workspace context teardown");
  }
  async loadCatalog() {
    let config = this.entry;
    try {
      const stored = JSON.parse(await readFile(resolve2(this.entry.aliasRoot, "..", "catalog.json"), "utf8"));
      config = { ...this.entry, ...stored, aliasRoot: this.entry.aliasRoot };
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const removed=await this.deletedAliasMarkers();
    if(removed.length){
      config={...config,retiredAliases:[...new Set([...(config.retiredAliases ?? []),...removed])],deletedWorkspaceAliases:[...new Set([...(config.deletedWorkspaceAliases ?? []),...removed])]};
      config.workspaces=config.workspaces.filter(workspace=>!config.retiredAliases.includes(normalizeLocal(resolve2(workspace.aliasPath ?? resolve2(config.aliasRoot,workspace.id)))));
      config=await this.saveCatalog(config);
    }
    await this.queueRefresh(config);
  }
  async deletedAliasMarkers() {
    const directory=resolve2(this.entry.aliasRoot,"..","deleted-projects");
    const names=await readdir(directory).catch(error=>{if(error.code==="ENOENT")return [];throw error;}),removed=[];
    for(const file of names){if(!/^[a-f0-9]{64}\.json$/.test(file))continue;const value=JSON.parse(await readFile(resolve2(directory,file),"utf8"));if(typeof value.aliasPath!=="string" || !isAbsolute2(value.aliasPath))throw new Error("Invalid project deletion marker");removed.push(normalizeLocal(resolve2(value.aliasPath)));}
    return removed;
  }
  async updateServer(id, patch) {
    const next = this.snapshot();
    const server = next.servers.find(s => s.id === id);
    if (!server) throw new Error("Unknown SSH host");
    Object.assign(server, patch, {id});
    await this.replaceSettings(next);
    return server;
  }
  /** Wait until the composition-layer catalog has published its aliases. */
  async [Service2.init]() {
    await this.initialRefresh;
  }
  /** Current detached catalog snapshot. */
  snapshot() {
    return structuredClone(this.current);
  }
  /** Select one custom OpenSSH config, or restore the platform defaults. */
  async setSshConfigFile(path) {
    await this.updateUserPreferences({ sshConfigFile: path ?? "" });
  }
  /** Update the native remote editor preference and its download fallback limit. */
  async setOpenFileSettings(input) {
    await this.updateUserPreferences({
      openFileMode: input.mode,
      openFileEditorPath: input.editorPath ?? ""
    });
  }
  /** Atomically update user-facing plugin preferences. Empty paths clear overrides. */
  async updateUserPreferences(input) {
    const next = this.snapshot();
    if (input.sshConfigFile !== void 0) {
      if (input.sshConfigFile.trim() === "") delete next.sshConfigFile;
      else next.sshConfigFile = input.sshConfigFile.trim();
    }
    if (input.openFileMode !== void 0) next.openFileMode = input.openFileMode;
    if (input.openFileEditorPath !== void 0) {
      if (input.openFileEditorPath.trim() === "") delete next.openFileEditorPath;
      else next.openFileEditorPath = input.openFileEditorPath.trim();
    }
    this.validate(next);
    await this.replaceSettings(next);
  }
  /** Browse directories through the server's shared AHP filesystem connection. */
  async listRemoteDirectory(server, requestedPath) {
    const host = await this.hostContext(server);
    const connection = await host.remote.getConnection();
    const home = connection.defaultDirectory === void 0 ? "/" : posixPathFromFileUri(String(connection.defaultDirectory));
    const path = posix4.normalize(requestedPath?.trim() || home);
    if (!posix4.isAbsolute(path)) throw new Error("remote directory path must be an absolute POSIX path");
    const listed = await connection.client.resourceList({ uri: fileUriFromPosixPath(path) });
    const crumbs=[];
    for(let current=path;;){crumbs.unshift({name:posix4.basename(current)||"/",path:current,hidden:posix4.basename(current).startsWith(".")});if(current==="/")break;current=posix4.dirname(current);}
    return {
      path,
      home,
      crumbs,
      truncated: false,
      ...path === "/" ? {} : { parent: posix4.dirname(path) },
      entries: listed.entries.filter((entry) => entry.type === "directory").sort((left, right) => left.name.localeCompare(right.name)).map((entry) => ({ name: entry.name, path: posix4.join(path, entry.name), hidden:entry.name.startsWith(".") }))
    };
  }
  async createRemoteDirectory(server,parent,name) {
    if(typeof parent!=="string"||!posix4.isAbsolute(parent))throw new Error("Select an absolute remote directory");
    if(typeof name!=="string"||!name.trim()||name==="."||name===".."||/[\\/\0\r\n]/.test(name))throw new Error("Enter a single folder name");
    await this.listRemoteDirectory(server,parent);
    const client=await (await this.hostContext(server)).remote.getClient();
    const path=posix4.join(parent,name);
    try {await client.resourceResolve({uri:fileUriFromPosixPath(path),followSymlinks:false});throw new Error("A file or folder with this name already exists");}catch(error){if(error.code!==AhpErrorCodes.NotFound)throw error;}
    await client.resourceMkdir({uri:fileUriFromPosixPath(path)});
    return path;
  }
  /** Create a server entry through the settings provider. */
  async addServer(input) {
    const server = { ...input, id: input.id ?? randomUUID3() };
    const next = this.snapshot();
    next.servers.push(server);
    this.validate(next);
    await this.replaceSettings(next);
    return server;
  }
  /** Create and register one remote workspace alias. */
  async addWorkspace(serverId, remotePath) {
    const workspace = { id: randomUUID3(), serverId, remotePath };
    const next = this.snapshot();
    next.workspaces.push(workspace);
    this.validate(next);
    await this.replaceSettings(next);
    await this.refreshTail;
    const route = this.routeByWorkspaceId.get(workspace.id);
    if (route === void 0) throw new Error(`remote workspace '${workspace.id}' was not published`);
    return route;
  }
  /** Rename one remote workspace without changing its execution route. */
  async renameWorkspace(id, title) {
    const normalizedTitle = title.trim();
    if (normalizedTitle.length === 0) throw new Error("remote workspace title must not be empty");
    const next = this.snapshot();
    const workspace = next.workspaces.find((candidate) => candidate.id === id);
    if (workspace === void 0) throw new Error(`dsh-remote-ssh: unknown remote workspace '${id}'`);
    workspace.title = normalizedTitle;
    this.validate(next);
    await this.replaceSettings(next);
    const route = this.routeByWorkspaceId.get(id);
    if (route === void 0) throw new Error(`remote workspace '${id}' was not published`);
    return route;
  }
  /** Retire the binding together with the native project; never remove remote files or session logs. */
  removeWorkspace(id,{native=true}={}) {
    const route=this.routeByWorkspaceId.get(id);
    if(route)this.retiringAliases.add(normalizeLocal(route.aliasPath));
    const task=this.retirementTail.then(async()=>{
      const currentRoute=this.routeByWorkspaceId.get(id) || route;
      if(!currentRoute)return false;
      const registry=this.workspaceRegistry;
      const nativeId=currentRoute.workspace.registryWorkspaceId || [...this.nativeWorkspaceIds].find(([,workspaceId])=>workspaceId===id)?.[0];
      const next=this.snapshot();next.workspaces=next.workspaces.filter(workspace=>workspace.id!==id);
      await this.replaceSettings(next);
      const nativeWorkspace=nativeId && registry?.get(nativeId);
      if(native && nativeWorkspace && normalizeLocal(resolve2(nativeWorkspace.path))===normalizeLocal(currentRoute.aliasPath))await registry.delete(nativeId);
      if(nativeId)this.nativeWorkspaceIds.delete(nativeId);
      await this.cleanupAlias(currentRoute.aliasPath);
      return true;
    });
    this.retirementTail=task.catch(()=>{});return task;
  }
  /** Delete only empty, plugin-owned placeholder folders. Non-empty/custom directories are preserved. */
  async cleanupAlias(path) {
    const root=resolve2(this.entry.aliasRoot),target=resolve2(path),rel=relative2(root,target);
    if(!rel || rel===".." || rel.startsWith(".."+sep2) || isAbsolute2(rel))return false;
    try{const info=await lstat(target);if(info.isSymbolicLink() || !info.isDirectory())return false;await rmdir(target);return true;}
    catch(error){if(["ENOENT","ENOTEMPTY","EEXIST","EBUSY"].includes(error.code))return false;throw error;}
  }
  async cleanupLocalAliases() {
    let removed=0,retained=0;
    for(const alias of this.current.retiredAliases ?? []){
      if(this.findAlias(alias)){retained++;continue;}
      if(await this.cleanupAlias(alias))removed++;
      else {try{await lstat(alias);retained++;}catch(error){if(error.code!=="ENOENT")throw error;}}
    }
    return {removed,retained};
  }
  /** Remove one server and tombstone all of its workspace execution routes. */
  async removeServer(id) {
    const next = this.snapshot();
    const before = next.servers.length;
    next.servers = next.servers.filter((server) => server.id !== id);
    if (next.servers.length === before) return false;
    next.workspaces = next.workspaces.filter((workspace) => workspace.serverId !== id);
    await this.replaceSettings(next);
    return true;
  }
  /** Pre-register a local directory with the stable LOCAL display prefix. */
  async adoptLocalWorkspace(path) {
    const registry = this.workspaceRegistry;
    if (registry === void 0) throw new Error("dsh-remote-ssh: workspace registry is unavailable");
    const absolute = resolve2(path);
    const title = `LOCAL > ${basename(absolute)}`;
    const workspace = await registry.create(absolute, title);
    if (workspace.title !== title) await workspace.setTitle(title);
    return workspace.path;
  }
  /** Resolve a tool path/cwd into the only execution world allowed to handle it. */
  route(path, cwd) {
    const cwdRoute = cwd === void 0 ? void 0 : this.findAlias(cwd);
    if (cwdRoute !== void 0) return cwdRoute;
    if (cwd !== void 0 && this.wasRemoteAlias(cwd)) {
      throw new Error(`dsh-remote-ssh: workspace alias is no longer configured: ${cwd}`);
    }
    if (path !== void 0 && isAbsolute2(path)) {
      const pathRoute = this.findAlias(path);
      if (pathRoute !== void 0) return pathRoute;
      if (this.wasRemoteAlias(path)) {
        throw new Error(`dsh-remote-ssh: workspace alias is no longer configured: ${path}`);
      }
    }
    return { kind: "local" };
  }
  /** Pin shell dispatch to the session workspace, regardless of an explicit tool workdir. */
  bindSession(sessionId, owner, cwd) {
    if (cwd !== void 0 && this.wasRemoteAlias(cwd)) {
      const route2 = this.findAlias(cwd);
      if (route2 !== void 0) {
        this.sessionWorlds.set(sessionId, { owner, workspaceId: route2.workspace.id });
        return route2;
      }
      this.sessionWorlds.set(sessionId, { owner, workspaceId: null, removedAlias: cwd });
      return void 0;
    }
    const route = cwd === void 0 ? { kind: "local" } : this.route(void 0, cwd);
    this.sessionWorlds.set(sessionId, {
      owner,
      workspaceId: route.kind === "remote" ? route.workspace.id : null
    });
    return route;
  }
  /** Release only the binding owned by this exact live Agent. */
  unbindSession(sessionId, owner) {
    if (this.sessionWorlds.get(sessionId)?.owner === owner) this.sessionWorlds.delete(sessionId);
  }
  /** Resolve the execution world bound to a live session without consulting path text. */
  sessionRoute(sessionId) {
    const bound = this.sessionWorlds.get(sessionId);
    if (bound === void 0) return void 0;
    if (bound.removedAlias !== void 0) {
      throw new Error(`dsh-remote-ssh: workspace alias is no longer configured: ${bound.removedAlias}`);
    }
    return bound.workspaceId === null ? { kind: "local" } : this.workspace(bound.workspaceId);
  }
  /** Resolve shell calls using their durable session world before considering workdir text. */
  routeShell(workdir, sessionId) {
    const bound = sessionId === void 0 ? void 0 : this.sessionRoute(sessionId);
    if (bound !== void 0) return bound;
    return this.route(void 0, workdir);
  }
  /** Model-facing shell dialect for a workspace cwd. Remote workspaces are POSIX today. */
  dialectFor(cwd) {
    if (cwd !== void 0 && (this.findAlias(cwd) !== void 0 || this.wasRemoteAlias(cwd))) {
      return "bash";
    }
    return process.platform === "win32" ? "pwsh" : "bash";
  }
  /** Presentation-only logical cwd that never exposes the local UUID alias. */
  displayRemoteCwd(route, workdir) {
    const remotePath = workdir === void 0 || workdir.trim() === "" ? route.workspace.remotePath : route.mapper.toRemotePath(workdir, route.aliasPath);
    const normalized = posix4.normalize(remotePath);
    const workspaceRoot = posix4.normalize(route.workspace.remotePath);
    const relativePath = posix4.relative(workspaceRoot, normalized);
    const workspaceTitle = route.workspace.title ?? `${route.server.label} > ${posix4.basename(workspaceRoot) || workspaceRoot}`;
    if (relativePath === "" || relativePath !== ".." && !relativePath.startsWith("../") && !posix4.isAbsolute(relativePath)) {
      return posix4.join("/", workspaceTitle, relativePath);
    }
    return posix4.join("/", `${route.server.label} > remote`, normalized);
  }
  /** Lookup a published route by its durable workspace id. */
  workspace(id) {
    const route = this.routeByWorkspaceId.get(id);
    if (route === void 0) throw new Error(`dsh-remote-ssh: unknown or removed remote workspace '${id}'`);
    return route;
  }
  /** Lazily boot the AHP filesystem context for one remote workspace. */
  async workspaceContext(route) {
    let pending = this.contexts.get(route.workspace.id);
    if (pending === void 0) {
      pending = this.createWorkspaceContext(route);
      this.contexts.set(route.workspace.id, pending);
      void pending.catch(() => {
        if (this.contexts.get(route.workspace.id) === pending) this.contexts.delete(route.workspace.id);
      });
    }
    return pending;
  }
  /** Resolve the SSH executable/options shared by all channels for this host. */
  sshTransport(route) {
    return this.transportFor(route.server);
  }
  /** AHP-backed shell view sharing the host runtime but retaining workspace path mapping. */
  async workspaceShell(route, dialect) {
    const key = `${route.workspace.id}:${dialect}`;
    let pending = this.shellContexts.get(key);
    if (pending === void 0) {
      pending = this.createWorkspaceShellContext(route, dialect);
      this.shellContexts.set(key, pending);
      void pending.catch(() => {
        if (this.shellContexts.get(key) === pending) this.shellContexts.delete(key);
      });
    }
    return (await pending).shell;
  }
  queueRefresh(config) {
    const run = this.refreshTail.then(() => this.publish(config));
    this.refreshTail = run.then(() => {
    }, () => {
    });
    return run;
  }
  async publish(config) {
    this.validate(config);
    await mkdir(resolve2(tmpdir(), "dsh-ssh"), { recursive: true });
    for (const alias of config.retiredAliases ?? []) this.remoteAliases.add(normalizeLocal(resolve2(alias)));
    const servers = new Map(config.servers.map((server) => [server.id, server]));
    const nextRoutes = /* @__PURE__ */ new Map();
    const nextById = /* @__PURE__ */ new Map();
    for (const workspace of config.workspaces) {
      const server = servers.get(workspace.serverId);
      const aliasPath = resolve2(workspace.aliasPath ?? resolve2(config.aliasRoot, workspace.id));
      await mkdir(aliasPath, { recursive: true });
      const canonicalAlias = resolve2(aliasPath);
      const route = {
        kind: "remote",
        server,
        workspace,
        aliasPath: canonicalAlias,
        mapper: new WorkspacePathMapper(canonicalAlias, workspace.remotePath)
      };
      nextRoutes.set(normalizeLocal(canonicalAlias), route);
      nextById.set(workspace.id, route);
      this.remoteAliases.add(normalizeLocal(canonicalAlias));
    }
    for (const [id, pending] of this.contexts) {
      const previous = this.routeByWorkspaceId.get(id);
      const next = nextById.get(id);
      if (this.current.sshConfigFile !== config.sshConfigFile || previous === void 0 || next === void 0 || routeRuntimeKey(previous) !== routeRuntimeKey(next)) {
        const settled = await Promise.resolve(pending).catch(() => void 0);
        if (settled !== void 0) await settled.ctx.fiber.dispose();
        this.contexts.delete(id);
      }
    }
    for (const [key, pending] of this.shellContexts) {
      const id = key.slice(0, key.lastIndexOf(":"));
      const previous = this.routeByWorkspaceId.get(id);
      const next = nextById.get(id);
      if (this.current.sshConfigFile !== config.sshConfigFile || previous === void 0 || next === void 0 || routeRuntimeKey(previous) !== routeRuntimeKey(next)) {
        const settled = await Promise.resolve(pending).catch(() => void 0);
        if (settled !== void 0) await settled.ctx.fiber.dispose();
        this.shellContexts.delete(key);
      }
    }
    for (const [id, pending] of this.hosts) {
      const next = servers.get(id);
      const settled = await Promise.resolve(pending).catch(() => void 0);
      if (this.current.sshConfigFile !== config.sshConfigFile || next === void 0 || settled === void 0 || settled.key !== serverRuntimeKey(next)) {
        if (settled !== void 0) await this.disposeHost(settled);
        this.hosts.delete(id);
      }
    }
    this.routes.clear();
    this.routeByWorkspaceId.clear();
    for (const [key, value] of nextRoutes) this.routes.set(key, value);
    for (const [key, value] of nextById) this.routeByWorkspaceId.set(key, value);
    this.current = structuredClone(config);
    await this.registerAllWorkspaces();
  }
  async registerAllWorkspaces({reconcileMissing=false}={}) {
    const registry = this.workspaceRegistry;
    if (registry === void 0) return;
    if(reconcileMissing){
      const deleted=new Set(this.current.deletedWorkspaceAliases ?? []);
      for(const workspace of registry.list())if(deleted.has(normalizeLocal(resolve2(workspace.path)))){
        await registry.delete(workspace.id);await this.cleanupAlias(workspace.path);
      }
    }
    let changed=false;
    for (const route of [...this.routeByWorkspaceId.values()]) {
      if(this.retiringAliases.has(normalizeLocal(route.aliasPath)))continue;
      if(route.workspace.registryWorkspaceId && !registry.get(route.workspace.registryWorkspaceId)){
        if(reconcileMissing)void this.removeWorkspace(route.workspace.id,{native:false}).catch(error=>this.ctx.logger.error(error));
        continue;
      }
      const title = route.workspace.title ?? `${route.server.label} > ${posix4.basename(route.workspace.remotePath) || route.workspace.remotePath}`;
      const workspace = await registry.create(route.aliasPath, title);
      if(this.retiringAliases.has(normalizeLocal(route.aliasPath))){await registry.delete(workspace.id);continue;}
      this.nativeWorkspaceIds.set(String(workspace.id),route.workspace.id);
      if(route.workspace.registryWorkspaceId!==String(workspace.id)){
        route.workspace.registryWorkspaceId=String(workspace.id);
        const record=this.current.workspaces.find(item=>item.id===route.workspace.id);if(record)record.registryWorkspaceId=String(workspace.id);
        changed=true;
      }
      if (workspace.title !== title) await workspace.setTitle(title);
    }
    if(changed)await this.saveCatalog(this.snapshot());
  }
  findAlias(path) {
    const absolute = normalizeLocal(resolve2(path));
    let best;
    for (const [alias, route] of this.routes) {
      if(this.retiringAliases.has(alias))continue;
      if (!isContained(alias, absolute)) continue;
      if (best === void 0 || alias.length > normalizeLocal(best.aliasPath).length) best = route;
    }
    return best;
  }
  findRemotePath(path) {
    if (!posix4.isAbsolute(path) || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\")) return void 0;
    const normalized = posix4.normalize(path);
    let best;
    let bestLength = -1;
    for (const route of this.routeByWorkspaceId.values()) {
      const root = posix4.normalize(route.workspace.remotePath);
      const rel = posix4.relative(root, normalized);
      if (rel !== "" && (rel === ".." || rel.startsWith("../") || posix4.isAbsolute(rel))) continue;
      if (root.length > bestLength) {
        best = route;
        bestLength = root.length;
      } else if (root.length === bestLength && best?.workspace.id !== route.workspace.id) {
        throw new Error(`dsh-remote-ssh: remote path matches multiple workspaces: ${path}`);
      }
    }
    return best;
  }
  wasRemoteAlias(path) {
    const absolute = normalizeLocal(resolve2(path));
    if ([...this.remoteAliases].some((alias) => isContained(alias, absolute))) return true;
    const root = normalizeLocal(resolve2(this.entry.aliasRoot));
    if (!isContained(root, absolute)) return false;
    const first = relative2(root, absolute).split(sep2)[0];
    // Reserve generated workspace IDs, not administrative files such as projects/.git.
    return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(first);
  }
  async createWorkspaceContext(route) {
    const host = await this.hostContext(route.server);
    const child = new Context2();
    try {
      child.provide("remoteSsh", host.remote);
      await child.plugin(fs_default, {
        remoteWorkspace: route.workspace.remotePath,
        localWorkspace: route.aliasPath
      });
      return { ctx: child, fs: child.fs, remote: host.remote };
    } catch (error) {
      await child.fiber.dispose().catch(() => {
      });
      throw error;
    }
  }
  async hostContext(server) {
    let pending = this.hosts.get(server.id);
    if (pending === void 0) {
      pending = this.createHostContext(server);
      this.hosts.set(server.id, pending);
      void pending.catch(() => {
        if (this.hosts.get(server.id) === pending) this.hosts.delete(server.id);
      });
    }
    return pending;
  }
  /** Non-blocking status snapshot; never join pending SSH startup or start an idle host. */
  connectionStatuses() {
    return {servers:this.current.servers.map(server=>({id:server.id,...(this.observedHosts?.get(server.id)?.remote.monitor.snapshot() ?? {state:this.hosts.has(server.id)?'connecting':'idle',updatedAt:null})})),workspaces:[...this.routeByWorkspaceId.values()].map(route=>({id:route.workspace.id,serverId:route.server.id,aliasPath:route.aliasPath}))};
  }
  async createWorkspaceShellContext(route, dialect) {
    const host = await this.hostContext(route.server);
    const child = new Context2();
    try {
      child.provide("remoteSsh", host.remote);
      await child.plugin(shell_default, {
        localWorkspace: route.aliasPath,
        remoteWorkspace: route.workspace.remotePath,
        shellCommand: dialect
      });
      return { ctx: child, shell: child.shell, remote: host.remote };
    } catch (error) {
      await child.fiber.dispose().catch(() => {
      });
      throw error;
    }
  }
  async createHostContext(server) {
    const child = new Context2();
    const transport = this.transportFor(server);
    try {
      await child.plugin(runtime_default, {
        sshTarget: server.sshTarget,
        sshExecutable: transport.executable,
        sshArgs: transport.args,
        remoteCodeCommand: server.remoteCodeCommand ?? "code",
        remoteAccessRoot: "/",
        startupTimeoutMs: this.current.startupTimeoutMs,
        requestTimeoutMs: this.current.requestTimeoutMs
      });
      const host={ ctx: child, remote: child.remoteSsh, key: serverRuntimeKey(server), server, transport };
      this.observedHosts ??= new Map();this.observedHosts.set(server.id,host);
      return host;
    } catch (error) {
      await child.fiber.dispose().catch(() => {
      });
      throw error;
    }
  }
  transportFor(server) {
    let executable = server.sshExecutable ?? "ssh";
    let multiplexed = process.platform !== "win32";
    if (process.platform === "win32") multiplexed = false;
    const args = [...server.sshArgs ?? [], ...(this.current.sshConfigFile ? ["-F", this.current.sshConfigFile] : [])];
    if (multiplexed) {
      const digest = createHash("sha256").update(`${process.pid}:${serverRuntimeKey(server)}`).digest("hex").slice(0, 16);
      const controlPath = resolve2(tmpdir(), "dsh-ssh", digest).replaceAll("\\", "/");
      args.push("-o", "ControlMaster=auto", "-o", "ControlPersist=60", "-o", `ControlPath=${controlPath}`);
    }
    return { executable, args, multiplexed };
  }
  async disposeHost(host) {
    if(this.observedHosts?.get(host.server.id)===host)this.observedHosts.delete(host.server.id);
    await host.ctx.fiber.dispose();
    if (!host.transport.multiplexed) return;
    await closeControlMaster(host.transport, host.server.sshTarget);
  }
  async replaceSettings(next) {
    const retired=new Set([...(this.current.retiredAliases ?? []),...(next.retiredAliases ?? []),...this.retiringAliases]);
    next.workspaces=next.workspaces.filter(workspace=>!retired.has(normalizeLocal(resolve2(workspace.aliasPath ?? resolve2(next.aliasRoot,workspace.id)))));
    const active = new Set(next.workspaces.map(w => normalizeLocal(resolve2(w.aliasPath ?? resolve2(next.aliasRoot,w.id)))));
    next.retiredAliases = [...new Set([...retired, ...[...this.remoteAliases].filter(alias => !active.has(alias))])];
    this.validate(next);
    const saved=await this.saveCatalog(next);
    await this.queueRefresh(saved);
  }
  async saveCatalog(next) {
    next=structuredClone(next);
    const markers=await this.deletedAliasMarkers();
    const retired=new Set([...(this.current.retiredAliases ?? []),...(next.retiredAliases ?? []),...this.retiringAliases,...markers]);
    next.workspaces=next.workspaces.filter(workspace=>!retired.has(normalizeLocal(resolve2(workspace.aliasPath ?? resolve2(next.aliasRoot,workspace.id)))));
    next.retiredAliases=[...retired];
    next.deletedWorkspaceAliases=[...new Set([...(this.current.deletedWorkspaceAliases ?? []),...(next.deletedWorkspaceAliases ?? []),...this.retiringAliases,...markers])];
    // Independent per-alias markers survive a stale/older process rewriting catalog.json.
    for(const aliasPath of next.deletedWorkspaceAliases){
      const directory=resolve2(this.entry.aliasRoot,"..","deleted-projects"),file=resolve2(directory,createHash("sha256").update(aliasPath).digest("hex")+".json");
      await mkdir(directory,{recursive:true});
      if(await lstat(file).then(()=>true,error=>{if(error.code==="ENOENT")return false;throw error;}))continue;
      const pending=file+"."+randomUUID3()+".tmp";await writeFile(pending,JSON.stringify({aliasPath})+"\n",{mode:0o600});await rename(pending,file);
    }
    const file = resolve2(this.entry.aliasRoot, "..", "catalog.json");
    const temp = file + "." + randomUUID3() + ".tmp";
    await mkdir(resolve2(file, ".."), {recursive: true});
    await writeFile(temp, JSON.stringify(next, null, 2) + "\n", {mode: 0o600});
    await rename(temp, file);
    return next;
  }
  validate(config) {
    if (!isAbsolute2(config.aliasRoot)) throw new Error("dsh-remote-ssh: aliasRoot must be an absolute local path");
    if (config.sshConfigFile !== void 0 && !isAbsolute2(config.sshConfigFile)) throw new Error("dsh-remote-ssh: sshConfigFile must be an absolute path");
    if (config.openFileEditorPath !== void 0 && !isAbsolute2(config.openFileEditorPath)) throw new Error("dsh-remote-ssh: openFileEditorPath must be an absolute path");
    if (config.openFileMode === "custom" && config.openFileEditorPath === void 0) throw new Error("dsh-remote-ssh: custom openFileMode requires openFileEditorPath");
    if (!Number.isSafeInteger(config.openFileDownloadMaxBytes) || config.openFileDownloadMaxBytes <= 0) throw new Error("dsh-remote-ssh: openFileDownloadMaxBytes must be a positive integer");
    if (!Number.isSafeInteger(config.startupTimeoutMs) || config.startupTimeoutMs <= 0) throw new Error("dsh-remote-ssh: startupTimeoutMs must be a positive integer");
    if (!Number.isSafeInteger(config.requestTimeoutMs) || config.requestTimeoutMs <= 0) throw new Error("dsh-remote-ssh: requestTimeoutMs must be a positive integer");
    for (const alias of config.retiredAliases ?? []) if (typeof alias !== "string" || !isAbsolute2(alias)) throw new Error("Retired workspace alias must be an absolute local path");
    const serverIds = /* @__PURE__ */ new Set();
    for (const server of config.servers) {
      if (!ID_PATTERN.test(server.id) || serverIds.has(server.id)) throw new Error(`dsh-remote-ssh: invalid or duplicate server id '${server.id}'`);
      if (server.label.trim().length === 0 || server.sshTarget.trim().length === 0) throw new Error(`dsh-remote-ssh: server '${server.id}' requires label and sshTarget`);
      if (server.sshExecutable !== void 0 && server.sshExecutable.trim().length === 0) throw new Error(`dsh-remote-ssh: server '${server.id}' sshExecutable must be non-empty`);
      if (server.backendPort !== void 0 && (!Number.isSafeInteger(server.backendPort) || server.backendPort < 0 || server.backendPort > 65535)) {
        throw new Error(`dsh-remote-ssh: server '${server.id}' backendPort must be between 0 and 65535`);
      }
      serverIds.add(server.id);
    }
    const workspaceIds = /* @__PURE__ */ new Set();
    const aliases = /* @__PURE__ */ new Set();
    for (const workspace of config.workspaces) {
      if (!ID_PATTERN.test(workspace.id) || workspaceIds.has(workspace.id)) throw new Error(`dsh-remote-ssh: invalid or duplicate workspace id '${workspace.id}'`);
      if (!serverIds.has(workspace.serverId)) throw new Error(`dsh-remote-ssh: workspace '${workspace.id}' refers to unknown server '${workspace.serverId}'`);
      if (!posix4.isAbsolute(workspace.remotePath)) throw new Error(`dsh-remote-ssh: workspace '${workspace.id}' remotePath must be an absolute POSIX path`);
      if (workspace.title !== void 0 && workspace.title.trim().length === 0) throw new Error(`dsh-remote-ssh: workspace '${workspace.id}' title must be non-empty`);
      const alias = normalizeLocal(resolve2(workspace.aliasPath ?? resolve2(config.aliasRoot, workspace.id)));
      if (aliases.has(alias)) throw new Error(`dsh-remote-ssh: duplicate workspace alias '${alias}'`);
      aliases.add(alias);
      workspaceIds.add(workspace.id);
    }
  }
};
function serverRuntimeKey(server) {
  return JSON.stringify([server.sshTarget, server.sshArgs ?? [], server.remoteCodeCommand ?? "code", server.sshExecutable ?? null, server.backendPort ?? DEFAULT_DSH_BACKEND_PORT]);
}
function routeRuntimeKey(route) {
  return JSON.stringify([serverRuntimeKey(route.server), route.workspace.remotePath, normalizeLocal(route.aliasPath)]);
}
async function closeControlMaster(transport, target) {
  await new Promise((resolvePromise) => {
    const child = spawn2(transport.executable, [...transport.args, "-O", "exit", target], {
      windowsHide: true,
      stdio: "ignore"
    });
    const timer = setTimeout(() => {
      child.kill();
      resolvePromise();
    }, 3e3);
    child.once("error", () => {
      clearTimeout(timer);
      resolvePromise();
    });
    child.once("close", () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}
function normalizeLocal(path) {
  return process.platform === "win32" ? path.toLowerCase() : path;
}
function isContained(parent, child) {
  const rel = relative2(parent, child);
  return rel === "" || rel !== ".." && !rel.startsWith(`..${sep2}`) && !isAbsolute2(rel);
}
var manager_default = RemoteSshManager;
export {
  RemoteSshManager,
  manager_default as default
};
