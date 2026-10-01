// Derived from Yan-Zero/dsh-remote-ssh 21d727cbe24fbae283196e5101adb3de2bdd9157 (Apache-2.0).
// See PROVIDER-LICENSE and NOTICE. Maintained snapshot for DSH SSH Workspace.

// .tmp/provider/src/routing/subprocess.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { win32 } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { ActionType } from "@microsoft/agent-host-protocol";
import { SubprocessRuntime } from "@deepseek-ai/dsh-subprocess";

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

// .tmp/provider/src/routing/subprocess.ts
var TransparentSubprocessRuntime = class extends SubprocessRuntime {
  static inject = ["localSubprocess", "remoteSshManager"];
  local;
  manager;
  remoteHandles = /* @__PURE__ */ new Set();
  remoteTerminals = /* @__PURE__ */ new Set();
  constructor(ctx) {
    super(ctx);
    this.local = ctx.localSubprocess;
    this.manager = ctx.remoteSshManager;
    ctx.effect(() => async () => {
      for (const handle of this.remoteHandles) handle.terminate();
      await Promise.allSettled([...this.remoteHandles].map((handle) => handle.done));
      await Promise.allSettled([...this.remoteTerminals].map((terminal) => terminal.terminate()));
    }, "Remote SSH subprocess teardown");
  }
  resolveExecutable(command, env, signal) {
    return this.local.resolveExecutable(command, env, signal);
  }
  spawn(spec) {
    const route = this.manager.route(void 0, spec.cwd);
    if (route.kind === "local") return this.local.spawn(spec);
    const handle = new RemoteAhpProcessHandle(
      route,
      this.manager.workspaceContext(route),
      this.manager.workspaceShell(route, "bash"),
      spec
    );
    this.remoteHandles.add(handle);
    void handle.done.finally(() => {
      this.remoteHandles.delete(handle);
    }).catch(() => {
    });
    return handle;
  }
  async spawnTerminal(spec) {
    const route = this.manager.route(void 0, spec.cwd);
    if (route.kind === "local") return this.local.spawnTerminal(spec);
    const handle = await RemoteAhpTerminalHandle.create(route, await this.manager.workspaceContext(route), spec);
    this.remoteTerminals.add(handle);
    void handle.done.finally(() => {
      this.remoteTerminals.delete(handle);
    }).catch(() => {
    });
    return handle;
  }
};
function canUseAhpSubprocess(_spec) {
  return true;
}
var RemoteAhpProcessHandle = class {
  constructor(route, workspace, shell, spec) {
    this.route = route;
    this.workspace = workspace;
    this.shell = shell;
    this.spec = spec;
    this.stdoutSink = new RemoteOutputSink(spec.stdio.stdout, process.stdout);
    this.stderrSink = new RemoteOutputSink(spec.stdio.stderr, process.stderr);
    this.stdout = this.stdoutSink.stream;
    this.stderr = this.stderrSink.stream;
    this.stdinPipe = spec.stdio.stdin === "pipe" ? new DeferredAhpStdin() : void 0;
    this.stdin = this.stdinPipe;
    this.collected = {
      ...this.stdoutSink.reader === void 0 ? {} : { stdout: this.stdoutSink.reader },
      ...this.stderrSink.reader === void 0 ? {} : { stderr: this.stderrSink.reader }
    };
    if (spec.signal !== void 0) {
      if (spec.signal.aborted) this.controller.abort(spec.signal.reason);
      else spec.signal.addEventListener("abort", () => {
        this.controller.abort(spec.signal?.reason);
      }, { once: true });
    }
    this.done = this.execute().catch((error) => {
      this.stdinPipe?.fail(error);
      throw error;
    }).finally(() => {
      this.settled = true;
      this.stdoutSink.end();
      this.stderrSink.end();
    });
  }
  route;
  workspace;
  shell;
  spec;
  pid = -1;
  stdin;
  stdout;
  stderr;
  collected;
  done;
  controller = new AbortController();
  stdoutSink;
  stderrSink;
  stdinPipe;
  settled = false;
  terminate() {
    if (!this.settled) this.controller.abort(new Error("remote subprocess terminated"));
  }
  async waitForExit(signal) {
    if (signal?.aborted) return false;
    return Promise.race([
      this.done.then(() => true, () => true),
      signal === void 0 ? new Promise(() => {
      }) : new Promise((resolvePromise) => {
        signal.addEventListener("abort", () => {
          resolvePromise(false);
        }, { once: true });
      })
    ]);
  }
  async execute() {
    const stdinMode = this.spec.stdio.stdin;
    const [{ remote }, shell] = await Promise.all([this.workspace, this.shell]);
    const client = await remote.getClient();
    const token = randomUUID2();
    const stdoutPath = `${remote.runtimeRoot}/process-${token}.stdout`;
    const stderrPath = `${remote.runtimeRoot}/process-${token}.stderr`;
    const stdinPath = `${remote.runtimeRoot}/process-${token}.stdin`;
    const fifoPath = `${remote.runtimeRoot}/process-${token}.fifo`;
    const stdoutUri = fileUriFromPosixPath(stdoutPath);
    const stderrUri = fileUriFromPosixPath(stderrPath);
    const stdinUri = fileUriFromPosixPath(stdinPath);
    const fifoUri = fileUriFromPosixPath(fifoPath);
    const empty = { data: "", encoding: "base64" };
    let writer;
    let completed = false;
    let run;
    try {
      await Promise.all([
        client.resourceWrite({ uri: stdoutUri, ...empty }),
        client.resourceWrite({ uri: stderrUri, ...empty }),
        stdinMode === "ignore" || stdinMode === "pipe" ? Promise.resolve() : client.resourceWrite({
          uri: stdinUri,
          data: Buffer.from(stdinMode.data).toString("base64"),
          encoding: "base64"
        })
      ]);
      if (stdinMode === "pipe") {
        const prepared = await shell.run(shell.resolve({
          command: `rm -f -- ${quotePosix(fifoPath)} && mkfifo -- ${quotePosix(fifoPath)}`,
          workdir: this.spec.cwd,
          signal: this.controller.signal,
          sandboxPolicy: { mode: "danger-full-access", workspaceRoot: this.route.aliasPath }
        }));
        if (prepared.exitCode !== 0) {
          if (this.controller.signal.aborted) return { exitCode: null, signal: prepared.signal ?? "SIGTERM" };
          throw new Error(`dsh-remote-ssh: failed to create remote stdin FIFO (exit ${prepared.exitCode ?? prepared.signal})`);
        }
      }
      const inputPath = stdinMode === "ignore" ? "/dev/null" : stdinMode === "pipe" ? fifoPath : stdinPath;
      const command = buildRemoteProcessCommand(this.spec.argv, this.spec.env, inputPath, stdoutPath, stderrPath);
      const resolved = shell.resolve({
        command,
        workdir: this.spec.cwd,
        signal: this.controller.signal,
        sandboxPolicy: { mode: "danger-full-access", workspaceRoot: this.route.aliasPath }
      });
      run = shell.run(resolved).finally(() => {
        completed = true;
      });
      if (stdinMode === "pipe") {
        const endMarker = `__DSH_STDIN_EOF_${randomUUID2().replaceAll("-", "")}__`;
        writer = await RemoteAhpTerminalHandle.create(this.route, await this.workspace, {
          argv: ["bash", "-c", buildRemoteStdinWriterCommand(fifoPath, endMarker)],
          cwd: this.spec.cwd,
          rows: 24,
          cols: 80,
          graceMs: this.spec.graceMs,
          signal: this.controller.signal
        });
        writer.output.resume();
        this.stdinPipe?.bind(writer, endMarker);
      }
      while (!completed) {
        await this.poll(client, stdoutUri, stderrUri);
        await delay(40);
      }
      const result = await run;
      await this.poll(client, stdoutUri, stderrUri);
      return { exitCode: result.exitCode, signal: result.signal };
    } catch (error) {
      this.stdinPipe?.fail(error);
      this.controller.abort(error);
      await run?.catch(() => {
      });
      throw error;
    } finally {
      if (writer !== void 0) await writer.terminate();
      this.stdinPipe?.finishRemote();
      await Promise.allSettled([
        client.resourceDelete({ uri: stdoutUri, recursive: false }),
        client.resourceDelete({ uri: stderrUri, recursive: false }),
        ...stdinMode === "ignore" || stdinMode === "pipe" ? [] : [client.resourceDelete({ uri: stdinUri, recursive: false })],
        ...stdinMode === "pipe" ? [client.resourceDelete({ uri: fifoUri, recursive: false })] : []
      ]);
    }
  }
  async poll(client, stdoutUri, stderrUri) {
    const [stdout, stderr] = await Promise.all([
      readRemoteOutput(client, stdoutUri),
      readRemoteOutput(client, stderrUri)
    ]);
    this.stdoutSink.update(stdout);
    this.stderrSink.update(stderr);
  }
};
var RemoteAhpTerminalHandle = class _RemoteAhpTerminalHandle {
  constructor(client, channel, subscription) {
    this.client = client;
    this.channel = channel;
    this.subscription = subscription;
    this.done = this.pump();
  }
  client;
  channel;
  subscription;
  pid = -1;
  output = new PassThrough();
  done;
  stopping;
  stopped = new Promise((resolvePromise) => {
    this.stopping = resolvePromise;
  });
  terminating;
  static async create(route, workspace, spec) {
    if (spec.signal?.aborted) throw spec.signal.reason ?? new Error("remote terminal allocation aborted");
    const client = await workspace.remote.getClient();
    const channel = `ahp-terminal:/${randomUUID2()}`;
    const claim = { kind: "client", clientId: workspace.remote.clientId };
    await client.request("createTerminal", {
      channel,
      claim,
      name: "DeepSeek Harness Remote SSH subprocess",
      cwd: fileUriFromPosixPath(route.mapper.toRemotePath(spec.cwd)),
      cols: spec.cols,
      rows: spec.rows
    });
    try {
      const subscribed = await client.subscribe(channel);
      const handle = new _RemoteAhpTerminalHandle(client, channel, subscribed.subscription);
      if (spec.signal?.aborted) {
        await handle.terminate();
        throw spec.signal.reason ?? new Error("remote terminal allocation aborted");
      }
      if (spec.signal !== void 0) {
        const onAbort = () => {
          void handle.terminate();
        };
        spec.signal.addEventListener("abort", onAbort, { once: true });
        void handle.done.finally(() => {
          spec.signal?.removeEventListener("abort", onAbort);
        }).catch(() => {
        });
      }
      client.dispatch(channel, { type: ActionType.TerminalInput, data: `${buildRemoteInteractiveCommand(spec.argv, spec.env)}\r` });
      return handle;
    } catch (error) {
      await client.request("disposeTerminal", { channel }).catch(() => {
      });
      throw error;
    }
  }
  async write(data) {
    this.client.dispatch(this.channel, { type: ActionType.TerminalInput, data });
  }
  async inspectForeground() {
    return void 0;
  }
  async signalForeground(signal) {
    if (signal === "SIGINT") {
      await this.write("");
      return -1;
    }
    if (signal === "SIGTSTP") {
      await this.write("");
      return -1;
    }
    throw new Error(`dsh-remote-ssh: AHP PTY cannot address a foreground process group for ${signal}`);
  }
  terminate() {
    this.terminating ??= (async () => {
      await this.client.request("disposeTerminal", { channel: this.channel }).catch(() => {
      });
      this.stopping?.("SIGTERM");
      await this.done.catch(() => {
      });
    })();
    return this.terminating;
  }
  async pump() {
    try {
      for (; ; ) {
        const next = await Promise.race([
          this.subscription.next().then((result) => ({ kind: "event", result })),
          this.stopped.then((signal) => ({ kind: "stopped", signal }))
        ]);
        if (next.kind === "stopped") return { exitCode: null, signal: next.signal };
        if (next.result.done) throw new Error("dsh-remote-ssh: AHP terminal subscription ended before terminal exit");
        const event = next.result.value;
        if (event.type !== "action") continue;
        const action = event.params.action;
        if (action.type === ActionType.TerminalData) this.output.write(action.data);
        else if (action.type === ActionType.TerminalExited) {
          return { exitCode: action.exitCode ?? null, signal: action.exitCode === void 0 ? "SIGTERM" : null };
        }
      }
    } finally {
      this.output.end();
      await this.subscription.close().catch(() => {
      });
      await this.client.request("disposeTerminal", { channel: this.channel }).catch(() => {
      });
    }
  }
};
var DeferredAhpStdin = class extends Writable {
  binding;
  resolveBinding;
  rejectBinding;
  bound = false;
  remoteFinished = false;
  constructor() {
    super();
    this.binding = new Promise((resolvePromise, reject) => {
      this.resolveBinding = resolvePromise;
      this.rejectBinding = reject;
    });
    this.on("error", () => {
    });
  }
  bind(terminal, endMarker) {
    if (this.bound || this.remoteFinished) return;
    this.bound = true;
    this.resolveBinding({ terminal, endMarker });
  }
  fail(reason) {
    if (!this.bound) {
      this.remoteFinished = true;
      this.rejectBinding(reason);
    }
    if (!this.destroyed) this.destroy(reason instanceof Error ? reason : new Error(String(reason)));
  }
  finishRemote() {
    this.remoteFinished = true;
    if (!this.bound) this.rejectBinding(new Error("dsh-remote-ssh: remote stdin pump ended before startup"));
  }
  _write(chunk, encoding, callback) {
    void this.sendChunk(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)).then(() => callback(), callback);
  }
  _final(callback) {
    void (async () => {
      const { terminal, endMarker } = await this.binding;
      await terminal.write(`${endMarker}
`);
      const outcome = await terminal.done;
      if (outcome.exitCode !== 0) throw new Error(`dsh-remote-ssh: stdin pump failed (exit ${outcome.exitCode ?? outcome.signal})`);
    })().then(() => callback(), callback);
  }
  async sendChunk(chunk) {
    if (this.remoteFinished) throw new Error("dsh-remote-ssh: remote stdin is already closed");
    const { terminal } = await this.binding;
    await terminal.write(`${chunk.toString("base64")}
`);
  }
};
var TailOutputReader = class {
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
  }
  maxBytes;
  tail = Buffer.alloc(0);
  tailStart = 0;
  total = 0;
  append(chunk) {
    this.total += chunk.length;
    const combined = Buffer.concat([this.tail, chunk]);
    if (combined.length <= this.maxBytes) {
      this.tail = combined;
      return;
    }
    const dropped = combined.length - this.maxBytes;
    this.tail = combined.subarray(dropped);
    this.tailStart += dropped;
  }
  readFrom(fromByte) {
    const lossy = fromByte < this.tailStart;
    const start = Math.max(fromByte, this.tailStart) - this.tailStart;
    return {
      text: this.tail.subarray(start).toString("utf8"),
      nextOffset: this.total,
      lossy
    };
  }
};
var RemoteOutputSink = class {
  constructor(mode, inherited) {
    this.inherited = inherited;
    this.stream = mode === "pipe" ? new PassThrough() : void 0;
    this.reader = typeof mode === "object" ? new TailOutputReader(mode.maxBytes) : void 0;
  }
  inherited;
  stream;
  reader;
  offset = 0;
  update(content) {
    if (content.length < this.offset) this.offset = 0;
    if (content.length === this.offset) return;
    const delta = content.subarray(this.offset);
    this.offset = content.length;
    if (this.stream !== void 0) this.stream.write(delta);
    else if (this.reader !== void 0) this.reader.append(delta);
    else this.inherited.write(delta);
  }
  end() {
    this.stream?.end();
  }
};
var BASE64 = "base64";
async function readRemoteOutput(client, uri) {
  const result = await client.resourceRead({ uri, encoding: BASE64 });
  return result.encoding === BASE64 ? Buffer.from(result.data, "base64") : Buffer.from(result.data, "utf8");
}
function buildRemoteProcessCommand(argv, env, stdinPath, stdoutPath, stderrPath) {
  const executable = argv[0];
  if (executable === void 0 || executable.length === 0) throw new Error("dsh-remote-ssh: subprocess argv must contain a program");
  const envArgs = [];
  for (const [key, value] of Object.entries(env ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`dsh-remote-ssh: invalid environment variable '${key}'`);
    if (value === void 0) envArgs.push("-u", key);
    else envArgs.push(`${key}=${value}`);
  }
  const remoteArgv = [remoteExecutable(executable), ...argv.slice(1)];
  return `exec env ${envArgs.map(quotePosix).join(" ")} ${remoteArgv.map(quotePosix).join(" ")} < ${quotePosix(stdinPath)} > ${quotePosix(stdoutPath)} 2> ${quotePosix(stderrPath)}`;
}
function buildRemoteInteractiveCommand(argv, env) {
  const executable = argv[0];
  if (executable === void 0 || executable.length === 0) throw new Error("dsh-remote-ssh: terminal argv must contain a program");
  const envArgs = [];
  for (const [key, value] of Object.entries(env ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`dsh-remote-ssh: invalid environment variable '${key}'`);
    envArgs.push(`${key}=${value}`);
  }
  const remoteArgv = [remoteExecutable(executable), ...argv.slice(1)];
  return `exec env ${envArgs.map(quotePosix).join(" ")} ${remoteArgv.map(quotePosix).join(" ")}`;
}
function buildRemoteStdinWriterCommand(fifoPath, endMarker) {
  return `while IFS= read -r line; do [ "$line" = ${quotePosix(endMarker)} ] && break; printf '%s' "$line" | base64 -d; done > ${quotePosix(fifoPath)}`;
}
async function delay(ms) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
function remoteExecutable(executable) {
  if (!/^(?:[A-Za-z]:[\\/]|\\\\)/.test(executable)) return executable;
  return win32.basename(executable).replace(/\.exe$/i, "");
}
var subprocess_default = TransparentSubprocessRuntime;
export {
  DeferredAhpStdin,
  TransparentSubprocessRuntime,
  buildRemoteInteractiveCommand,
  buildRemoteProcessCommand,
  buildRemoteStdinWriterCommand,
  canUseAhpSubprocess,
  subprocess_default as default
};
