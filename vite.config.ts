import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri serves the Vite app at this fixed port during local development.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2021",
  },
});
