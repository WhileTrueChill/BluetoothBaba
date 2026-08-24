import { defineConfig } from "vite";

// Vite config tuned for Tauri v2. The dev server settings only matter for
// `npm run tauri dev`; CI only ever runs `vite build` (via beforeBuildCommand).
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  // Tauri expects a fixed port and no cleared screen so its logs stay visible.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      // Don't reload the web app when the Rust side changes.
      ignored: ["**/src-tauri/**", "**/tauri-plugin-blemesh/**"],
    },
  },
  build: {
    // Android WebView (Chromium) is modern; es2021 keeps output small & fast.
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
    outDir: "dist",
    emptyOutDir: true,
  },
});
