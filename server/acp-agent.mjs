import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { withoutTaskboardLauncherEnvironment } from "../shared/codex-environment.mjs";
import { signalProcessTree } from "../shared/process-tree.mjs";

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_LINE_BYTES = 16 * 1024 * 1024;
const STREAM_INTERVAL_MS = 250;

export class AcpAgentServerError extends Error {
  constructor(message) {
    super(message);
    this.name = "AcpAgentServerError";
  }
}

// Minimal Agent Client Protocol client. It exposes the same surface AiChatService
// uses for the Codex app-server (startThread / resumeThread / startTurn /
// interruptTurn / subscribe) so one chat run loop can drive either backend.
export class AcpAgentServer {
  constructor({ executable, args = ["acp"], processEnv = process.env, requestTimeoutMs } = {}) {
    this.executable = executable;
    this.args = args;
    this.processEnv = withoutTaskboardLauncherEnvironment(processEnv);
    this.requestTimeoutMs = requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.child = null;
    this.starting = null;
    this.nextRequestId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.sessions = new Map();
    this.sessionConfig = new Map();
    this.buffer = "";
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async startThread({ cwd, model, sandbox } = {}) {
    const sessionId = await this.#createSession(cwd);
    this.sessions.set(sessionId, {
      cwd,
      sandbox,
      mode: sandbox === "read-only" ? "plan" : "default",
      buffer: "",
      messageId: null,
      turnId: null,
    });
    await this.#applyModel(sessionId, model);
    await this.#applyMode(sessionId);
    return { thread: { id: sessionId } };
  }

  async resumeThread({ threadId, cwd, model, sandbox } = {}) {
    const session = this.sessions.get(threadId);
    if (session) return { thread: { id: threadId } };
    await this.request("session/load", { sessionId: threadId, cwd, mcpServers: [] });
    this.sessions.set(threadId, {
      cwd,
      sandbox,
      mode: sandbox === "read-only" ? "plan" : "default",
      buffer: "",
      messageId: null,
      turnId: null,
    });
    await this.#applyModel(threadId, model);
    await this.#applyMode(threadId);
    return { thread: { id: threadId } };
  }

  async startTurn({ threadId, input, effort }) {
    const session = this.sessions.get(threadId);
    if (!session) {
      throw new AcpAgentServerError(`ACP session '${threadId}' is not open`);
    }
    if (session.busy) {
      throw new AcpAgentServerError("ACP session is already running a turn");
    }
    if (effort) await this.#applyConfig(threadId, "thinking", effort);
    const turnId = randomUUID();
    session.busy = true;
    session.turnId = turnId;
    session.buffer = "";
    session.messageId = null;
    session.streamId = null;
    session.lastEmit = 0;
    this.#notify({ method: "turn/started", params: { threadId, turnId } });
    void this.#runPrompt(threadId, turnId, toPromptBlocks(input));
    return { turn: { id: turnId } };
  }

  async interruptTurn({ threadId }) {
    const session = this.sessions.get(threadId);
    if (!session?.busy) return { ok: true };
    session.interrupted = true;
    await this.request("session/cancel", { sessionId: threadId }).catch(() => {});
    return { ok: true };
  }

  async catalog({ cwd } = {}) {
    const sessionId = await this.#createSession(cwd);
    try {
      const options = this.sessionConfig.get(sessionId) ?? [];
      return configCatalog(options);
    } finally {
      await this.request("session/close", { sessionId }).catch(() => {});
      this.sessions.delete(sessionId);
      this.sessionConfig.delete(sessionId);
    }
  }

  async close() {
    const error = new AcpAgentServerError("ACP agent closed");
    this.#rejectPending(error);
    this.listeners.clear();
    this.sessions.clear();
    const child = this.child;
    this.child = null;
    this.starting = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.stdin.end();
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        signalProcessTree(child, "SIGKILL");
        resolve();
      }, 1_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async request(method, params) {
    const child = await this.#ensureStarted();
    return this.#sendRequest(child, method, params);
  }

  async #createSession(cwd) {
    const result = await this.request("session/new", { cwd, mcpServers: [] });
    const sessionId = result?.sessionId;
    if (typeof sessionId !== "string" || !sessionId) {
      throw new AcpAgentServerError("ACP agent did not provide a session id");
    }
    this.sessionConfig.set(sessionId, result?.configOptions ?? []);
    return sessionId;
  }

  async #applyModel(sessionId, model) {
    if (!model) return;
    await this.#applyConfig(sessionId, "model", model);
  }

  async #applyMode(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session?.mode) return;
    await this.#applyConfig(sessionId, "mode", session.mode);
  }

  async #applyConfig(sessionId, configId, value) {
    const options = this.sessionConfig.get(sessionId) ?? [];
    const supported = options.find((option) => (
      option?.category === configId || option?.id === configId
    ));
    if (!supported) return;
    if (Array.isArray(supported.options) && supported.options.length > 0) {
      const allowed = supported.options.some((option) => option?.value === value);
      if (!allowed) return;
    }
    await this.request("session/set_config_option", { sessionId, configId, value })
      .catch(() => {});
  }

  async #runPrompt(threadId, turnId, prompt) {
    const session = this.sessions.get(threadId);
    let status = "completed";
    let error;
    try {
      const result = await this.request("session/prompt", { sessionId: threadId, prompt });
      const stopReason = result?.stopReason;
      if (session?.interrupted || stopReason === "cancelled") status = "interrupted";
      else if (stopReason === "refusal") status = "failed";
      if (status === "failed") error = "The agent refused the request";
    } catch (requestError) {
      status = session?.interrupted ? "interrupted" : "failed";
      error = requestError instanceof Error ? requestError.message : String(requestError);
    } finally {
      if (session) {
        session.busy = false;
        session.interrupted = false;
        session.turnId = null;
      }
      this.#flushMessage(threadId, turnId);
      this.#notify({
        method: "turn/completed",
        params: {
          threadId,
          turnId,
          turn: { status, ...(error ? { error: { message: error } } : {}) },
        },
      });
    }
  }

  #flushMessage(threadId, turnId) {
    const session = this.sessions.get(threadId);
    if (!session || !session.buffer) return;
    const text = session.buffer;
    const itemId = session.streamId ?? session.messageId ?? randomUUID();
    session.buffer = "";
    session.messageId = null;
    session.streamId = null;
    this.#notify({
      method: "item/completed",
      params: {
        threadId,
        turnId,
        item: { id: itemId, type: "agentMessage", text, status: "completed" },
      },
    });
  }

  #handleUpdate(params) {
    const threadId = params?.sessionId;
    const session = threadId ? this.sessions.get(threadId) : undefined;
    const update = params?.update;
    if (!session || !update) return;
    if (update.sessionUpdate === "agent_message_chunk") {
      const text = update.content?.type === "text" ? update.content.text : "";
      if (update.messageId && session.messageId && update.messageId !== session.messageId) {
        this.#flushMessage(threadId, session.turnId);
      }
      if (update.messageId) session.messageId = update.messageId;
      if (!text) return;
      session.buffer += text;
      session.streamId ??= update.messageId ?? randomUUID();
      const timestamp = Date.now();
      if (timestamp - (session.lastEmit ?? 0) < STREAM_INTERVAL_MS) return;
      session.lastEmit = timestamp;
      this.#notify({
        method: "item/updated",
        params: {
          threadId,
          turnId: session.turnId,
          item: {
            id: session.streamId,
            type: "agentMessage",
            text: session.buffer,
            status: "in_progress",
          },
        },
      });
      return;
    }
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      this.#flushMessage(threadId, session.turnId);
      const title = typeof update.title === "string" && update.title
        ? update.title
        : update.kind ?? "tool";
      this.#notify({
        method: "item/completed",
        params: {
          threadId,
          turnId: session.turnId,
          item: {
            id: update.toolCallId ?? randomUUID(),
            type: "mcpToolCall",
            server: "omp",
            tool: title,
            status: update.status === "failed" ? "failed" : "completed",
            ...(update.status === "failed" ? { error: { message: title } } : {}),
          },
        },
      });
    }
  }

  async #handlePermissionRequest(message) {
    const sessionId = message.params?.sessionId;
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    const options = Array.isArray(message.params?.options) ? message.params.options : [];
    const allow = session?.sandbox !== "read-only";
    const preferred = allow
      ? options.find((option) => option?.kind?.startsWith("allow")) ?? options[0]
      : options.find((option) => option?.kind?.startsWith("reject"))
        ?? options.find((option) => option?.kind === "reject_once");
    const outcome = preferred
      ? { outcome: "selected", optionId: preferred.optionId }
      : { outcome: "cancelled" };
    this.#write({ jsonrpc: "2.0", id: message.id, result: { outcome } });
  }

  async #ensureStarted() {
    if (this.child) return this.child;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const child = spawn(this.executable, this.args, {
        env: this.processEnv,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      this.child = child;
      this.buffer = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => this.#handleStdout(chunk));
      child.stderr.on("data", () => {});
      child.on("error", (error) => this.#handleExit(child, error));
      child.on("exit", (code, signal) => {
        this.#handleExit(
          child,
          new AcpAgentServerError(
            `ACP agent exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}`,
          ),
        );
      });
      await this.#sendRequest(child, "initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      });
      return child;
    })();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  #handleStdout(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > MAX_LINE_BYTES && !this.buffer.includes("\n")) {
      this.buffer = "";
      return;
    }
    let index;
    while ((index = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      this.#handleMessage(message);
    }
  }

  #handleMessage(message) {
    if (message.id !== undefined && message.method === undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new AcpAgentServerError(message.error.message ?? "ACP request failed"));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method === "session/update") {
      this.#handleUpdate(message.params);
      return;
    }
    if (message.method === "session/request_permission") {
      void this.#handlePermissionRequest(message);
      return;
    }
    if (message.id !== undefined && message.method !== undefined) {
      this.#write({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `Unsupported request '${message.method}'` },
      });
    }
  }

  #sendRequest(child, method, params) {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AcpAgentServerError(`ACP request '${method}' timed out`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.#write({ jsonrpc: "2.0", id, method, params }, child);
    });
  }

  #write(message, child = this.child) {
    if (!child || child.exitCode !== null) return;
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #notify(notification) {
    for (const listener of this.listeners) {
      try {
        listener(notification);
      } catch {
        // A failing listener must not break the transport.
      }
    }
  }

  #handleExit(child, error) {
    if (this.child === child) this.child = null;
    this.#rejectPending(error);
    for (const [sessionId, session] of this.sessions) {
      if (!session.busy) continue;
      session.busy = false;
      this.#notify({
        method: "turn/completed",
        params: { threadId: sessionId, turnId: session.turnId, turn: { status: "failed", error: { message: error.message } } },
      });
    }
    this.#notify({ method: "app-server/terminated", params: { message: error.message } });
  }

  #rejectPending(error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

function toPromptBlocks(input) {
  if (!Array.isArray(input)) return [{ type: "text", text: String(input ?? "") }];
  const blocks = [];
  for (const part of input) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "text" && typeof part.text === "string") {
      blocks.push({ type: "text", text: part.text });
    } else if (part.type === "image" && typeof part.url === "string") {
      const match = /^data:([^;]+);base64,(.*)$/s.exec(part.url);
      if (match) blocks.push({ type: "image", mimeType: match[1], data: match[2] });
    }
  }
  return blocks.length > 0 ? blocks : [{ type: "text", text: "" }];
}

function configCatalog(options) {
  const modelOption = options.find((option) => option?.category === "model");
  const effortOption = options.find((option) => option?.category === "thought_level");
  const efforts = Array.isArray(effortOption?.options)
    ? effortOption.options.flatMap((option) => (
      typeof option?.value === "string" && option.value ? [option.value] : []
    ))
    : [];
  const models = Array.isArray(modelOption?.options)
    ? modelOption.options.flatMap((option) => {
      const slug = typeof option?.value === "string" ? option.value.trim() : "";
      if (!slug) return [];
      return [{
        slug,
        displayName: typeof option.name === "string" && option.name ? option.name : slug,
        supportedReasoningEfforts: efforts,
        defaultReasoningEffort: typeof effortOption?.currentValue === "string"
          ? effortOption.currentValue
          : efforts[0],
      }];
    })
    : [];
  return {
    models,
    efforts,
    defaultModel: typeof modelOption?.currentValue === "string" ? modelOption.currentValue : undefined,
  };
}
