import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// Absolute path to the claude-code-acp adapter script, injected at build time.
// In dev: points to node_modules in the project tree.
// Production builds: TODO — bundle the adapter as a sidecar resource.
const ACP_SCRIPT_PATH = path.resolve(
  __dirname,
  "node_modules/@zed-industries/claude-code-acp/dist/index.js",
);

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [tailwindcss(), react()],

  define: {
    __ACP_SCRIPT_PATH__: JSON.stringify(ACP_SCRIPT_PATH),
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
