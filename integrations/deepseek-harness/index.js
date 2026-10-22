import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const name = "codex-taskboard";
export const inject = ["webServer"];

const ROUTE = "/integrations/codex-taskboard";
const HOST_PARAM = "deepseek-harness";
const DEFAULT_API_URL = "http://127.0.0.1:47823";
const PROBE_TIMEOUT_MS = 1500;

/** The launcher-owned runtime descriptor for the current platform. */
function defaultRuntimeFile() {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Codex Taskboard", "launcher-runtime.json");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Codex Taskboard", "launcher-runtime.json");
  }
  const dataHome = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "Codex Taskboard", "launcher-runtime.json");
}

/** Descriptor files worth reading, most explicit first. */
function runtimeFiles() {
  const files = [];
  if (process.env.CODEX_TASKBOARD_RUNTIME_FILE) files.push(process.env.CODEX_TASKBOARD_RUNTIME_FILE);
  if (process.env.CODEX_TASKBOARD_DATA_DIR) {
    files.push(path.join(process.env.CODEX_TASKBOARD_DATA_DIR, "launcher-runtime.json"));
  }
  files.push(defaultRuntimeFile());
  return files;
}

async function descriptorUrl(file) {
  const descriptor = JSON.parse(await readFile(file, "utf8"));
  if (descriptor?.version !== 1 || typeof descriptor.url !== "string") {
    throw new Error(`The active Codex Taskboard runtime is invalid: ${file}`);
  }
  return descriptor.url;
}

/** Every endpoint worth trying: descriptors, then an explicit URL, then the plain default. */
async function candidateUrls() {
  const urls = [];
  for (const file of runtimeFiles()) {
    try {
      urls.push(await descriptorUrl(file));
    } catch {
      // A missing or unreadable descriptor is expected when the server runs in plain mode.
    }
  }
  if (process.env.CODEX_TASKBOARD_URL) urls.push(process.env.CODEX_TASKBOARD_URL);
  urls.push(DEFAULT_API_URL);
  return [...new Set(urls)];
}

/** Only an endpoint answering the taskboard's own API is worth embedding. */
async function reachable(base) {
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/api/projects`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const body = await response.json();
    return Array.isArray(body?.projects);
  } catch {
    return false;
  }
}

async function activeTaskboardUrl() {
  for (const base of await candidateUrls()) {
    if (!(await reachable(base))) continue;
    const url = new URL(`${base.replace(/\/$/, "")}/`);
    url.searchParams.set("host", HOST_PARAM);
    return url.href;
  }
  throw new Error("no reachable Codex Taskboard endpoint");
}

export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({
      kind: "exact",
      path: ROUTE,
      handler: async (_request, response) => {
        try {
          response.writeHead(307, {
            location: await activeTaskboardUrl(),
            "cache-control": "no-store",
          });
          response.end();
        } catch {
          response.writeHead(503, {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          });
          response.end("Codex Taskboard is not running.");
        }
      },
    }),
    "codex-taskboard: active runtime route",
  );
}
