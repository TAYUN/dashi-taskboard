import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("../dist/web", import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    // 固定使用不常见的端口，避免与其它 Vite 任务抢占常用的 5173。
    port: 47824,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:47823",
    },
  },
});
