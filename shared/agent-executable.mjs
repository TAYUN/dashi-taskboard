import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";

function executableFile(candidate, platform) {
  const names = platform === "win32" && !path.win32.extname(candidate)
    ? [candidate, `${candidate}.exe`, `${candidate}.cmd`, `${candidate}.bat`]
    : [candidate];
  for (const name of names) {
    try {
      accessSync(name, constants.X_OK);
      return name;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

// Resolve an agent CLI the same way a shell would. Node on Windows cannot spawn
// an extensionless shim such as ~/.bun/bin/omp, so the .exe/.cmd variants and the
// usual package-manager bin directories are probed explicitly.
export function resolveAgentExecutable(command, {
  env = process.env,
  platform = process.platform,
  homeDirectory = os.homedir(),
} = {}) {
  if (typeof command !== "string" || !command.trim()) return null;
  const name = command.trim();
  if (path.isAbsolute(name)) return executableFile(name, platform);
  for (const directory of (env.PATH || "").split(path.delimiter)) {
    if (!directory) continue;
    const resolved = executableFile(path.join(directory, name), platform);
    if (resolved) return resolved;
  }
  const fallbackDirectories = platform === "win32"
    ? [
      path.join(homeDirectory, ".bun", "bin"),
      path.join(homeDirectory, "AppData", "Local", "pnpm"),
      path.join(homeDirectory, "AppData", "Roaming", "npm"),
    ]
    : [
      path.join(homeDirectory, ".bun", "bin"),
      path.join(homeDirectory, ".local", "bin"),
      "/usr/local/bin",
      "/opt/homebrew/bin",
    ];
  for (const directory of fallbackDirectories) {
    const resolved = executableFile(path.join(directory, name), platform);
    if (resolved) return resolved;
  }
  return null;
}
