/// <reference types="vitest" />
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import type { Plugin } from "vite";

/** Silent paths — proxied but not logged (high-frequency or internal noise). */
const SILENT_PATHS = new Set(["/api/v1/debug/log"]);

/** Logs proxied API and health requests to the Vite terminal. */
function apiLogger(): Plugin {
  return {
    name: "api-logger",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        const isProxied =
          url.startsWith("/api/") ||
          url === "/health" ||
          url === "/ready";
        if (!isProxied) return next();

        const basePath = url.split("?")[0];
        if (SILENT_PATHS.has(basePath)) return next();

        const start = Date.now();
        const method = req.method ?? "GET";
        process.stdout.write(`\x1b[2m ○\x1b[0m \x1b[36m${method}\x1b[0m ${url}\n`);
        res.on("finish", () => {
          const ms = Date.now() - start;
          const s = res.statusCode;
          const c = s >= 500 ? "\x1b[31m" : s >= 400 ? "\x1b[33m" : "\x1b[32m";
          process.stdout.write(` ${c}${s}\x1b[0m \x1b[36m${method}\x1b[0m ${url} \x1b[2min ${ms}ms\x1b[0m\n`);
        });
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, "..", "");
  const frontendEnv = loadEnv(mode, ".", "");
  const apiPort = rootEnv.API_HOST_PORT || process.env.API_HOST_PORT || "8000";
  const webPort = rootEnv.WEB_HOST_PORT || process.env.WEB_HOST_PORT || "5173";
  const devApiTarget = `http://localhost:${apiPort}`;
  const productionApiTarget =
    frontendEnv.VITE_API_BASE_URL ||
    rootEnv.VITE_API_BASE_URL ||
    process.env.VITE_API_BASE_URL ||
    devApiTarget;
  // Dev proxy must follow the root stack port. A stale frontend/.env can point
  // the UI at a different API/DB than the MQTT subscriber.
  const apiTarget = mode === "production" ? productionApiTarget : devApiTarget;

  return {
    plugins: [react(), apiLogger()],
    server: {
      port: Number(webPort),
      host: true,
      proxy: {
        "^/api/": {
          target: apiTarget,
          changeOrigin: true,
        },
        "/docs": { target: apiTarget, changeOrigin: true },
        "/openapi.json": { target: apiTarget, changeOrigin: true },
        "/health": {
          target: apiTarget,
          changeOrigin: true,
        },
        "/ready": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    define: {
      // Dev: empty base → requests go through Vite proxy → logged in terminal
      // Prod: explicit URL → calls backend directly
      "import.meta.env.VITE_API_BASE_URL": JSON.stringify(
        mode === "production" ? apiTarget : "",
      ),
      "import.meta.env.VITE_DEBUG_LOGS": JSON.stringify(rootEnv.VITE_DEBUG_LOGS || "false"),
      "import.meta.env.VITE_DEBUG_LOG_LEVEL": JSON.stringify(rootEnv.VITE_DEBUG_LOG_LEVEL || "normal"),
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            "react-vendor": ["react", "react-dom", "react-router-dom"],
            "query-vendor": ["@tanstack/react-query"],
            "icons-vendor": ["lucide-react"],
          },
        },
      },
      chunkSizeWarningLimit: 600,
    },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: ["./src/test-setup.ts"],
    },
  };
});
