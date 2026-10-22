import { spawn } from "node:child_process";

// Windows 上 Node 不允许直接 spawn .cmd（会抛 EINVAL），因此把整条命令交给 shell 执行。
const webDev =
  process.platform === "win32"
    ? spawn("npm.cmd run dev:web", { stdio: "inherit", shell: true })
    : spawn("npm", ["run", "dev:web"], { stdio: "inherit" });

const children = [
  spawn(process.execPath, ["--watch", "server/index.mjs", "--dev"], {
    stdio: "inherit",
  }),
  webDev,
];

let shuttingDown = false;

function stop(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = exitCode;
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (!shuttingDown && code !== 0 && signal !== "SIGTERM") stop(code ?? 1);
  });
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
