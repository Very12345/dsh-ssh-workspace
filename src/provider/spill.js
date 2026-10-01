// Derived from Yan-Zero/dsh-remote-ssh 21d727cbe24fbae283196e5101adb3de2bdd9157 (Apache-2.0).
// See PROVIDER-LICENSE and NOTICE. Maintained snapshot for DSH SSH Workspace.

// .tmp/provider/src/routing/spill.ts
import { createHash, randomBytes } from "node:crypto";
import { posix as posix2 } from "node:path";
import { ContentEncoding } from "@microsoft/agent-host-protocol";
import { SpillLocator, SpillStore } from "@deepseek-ai/dsh-spill";

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
var VALIDATED_FORWARD_PROTOCOL_VERSIONS = ["0.8.0"];
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
    'if [ "$dsh_code" = code ] && ! command -v "$dsh_code" >/dev/null 2>&1 && [ -x "$HOME/.dsh-ssh-workspace/cli/bin/code" ]; then dsh_code="$HOME/.dsh-ssh-workspace/cli/bin/code"; fi',
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
      try {
        const connection = await this.ready;
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
    const connection = await this.ready;
    if (this.disposed) throw new Error("Remote SSH service is disposing");
    return connection;
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
    if (this.config.directUrl !== void 0) return this.connectEndpoint(this.config.directUrl);
    return this.openOverSsh();
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

// .tmp/provider/src/routing/spill.ts
var name = "dsh-remote-ssh-spill";
var inject = ["localSpillStore", "remoteSshManager"];
var TransparentSpillStore = class extends SpillStore {
  static inject = ["localSpillStore", "remoteSshManager"];
  local;
  manager;
  constructor(ctx) {
    super(ctx);
    this.local = ctx.localSpillStore;
    this.manager = ctx.remoteSshManager;
  }
  async saveText(input) {
    const route = this.manager.sessionRoute(String(input.owner.sessionId));
    if (route === void 0) {
      throw new Error(`dsh-remote-ssh: no execution world is bound to spill session '${String(input.owner.sessionId)}'`);
    }
    if (route.kind === "local") return this.local.saveText(input);
    return saveRemoteSpill(this.manager, route, input);
  }
};
async function saveRemoteSpill(manager, route, input) {
  const [{ remote }, shell] = await Promise.all([
    manager.workspaceContext(route),
    manager.workspaceShell(route, "bash")
  ]);
  const directory = remoteSpillDirectory(remote.runtimeRoot, String(input.owner.sessionId));
  const path = posix2.join(directory, `${randomBytes(12).toString("hex")}-${safeSuggestedName(input.suggestedName)}`);
  const prepared = await shell.run(shell.resolve({
    command: `umask 077 && mkdir -p -m 700 -- ${quotePosix(directory)}`,
    workdir: route.aliasPath,
    timeoutMs: 3e4,
    stdoutMaxBytes: 16 * 1024,
    sandboxPolicy: { mode: "danger-full-access", workspaceRoot: route.aliasPath }
  }));
  if (prepared.exitCode !== 0) {
    throw new Error(`dsh-remote-ssh: failed to prepare remote spill directory: ${prepared.stderr.text.slice(-2048)}`);
  }
  const client = await remote.getClient();
  await client.resourceWrite({
    uri: fileUriFromPosixPath(path),
    data: input.content,
    encoding: ContentEncoding.Utf8,
    contentType: "text/plain; charset=utf-8",
    createOnly: true
  });
  return {
    locator: SpillLocator(path),
    bytes: Buffer.byteLength(input.content, "utf8"),
    retrievalHint: "Use read with offset/limit, or grep this path to search within it."
  };
}
function remoteSpillDirectory(runtimeRoot, sessionId) {
  const owner = createHash("sha256").update(sessionId).digest("hex").slice(0, 16);
  return posix2.join(runtimeRoot, "spills", `session-${owner}`);
}
function safeSuggestedName(value) {
  const safe = [...value].map((character) => /^[A-Za-z0-9._-]$/.test(character) ? character : "_").join("");
  const bounded = safe.slice(0, 96);
  return bounded === "" || bounded === "." || bounded === ".." ? "result.txt" : bounded;
}
var spill_default = TransparentSpillStore;
export {
  TransparentSpillStore,
  spill_default as default,
  inject,
  name,
  remoteSpillDirectory,
  safeSuggestedName,
  saveRemoteSpill
};
