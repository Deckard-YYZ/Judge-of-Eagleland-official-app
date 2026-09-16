import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const buildId = randomUUID();

// Tauri serves the Vite app at this fixed port during local development.
export default defineConfig({
  define: { "import.meta.env.VITE_DIAGNOSTIC_BUILD_ID": JSON.stringify(buildId) },
  plugins: [
    react(),
    {
      name: "build-identity",
      async generateBundle(_options, bundle) {
        const directory = `artifacts/build-support/${buildId}`;
        await mkdir(directory, { recursive: true });
        for (const [name, artifact] of Object.entries(bundle)) {
          if (artifact.type === "asset" && name.endsWith(".map")) {
            await mkdir(`${directory}/${name.split("/").slice(0, -1).join("/")}`, {
              recursive: true,
            });
            await writeFile(`${directory}/${name}`, artifact.source);
            delete bundle[name];
          }
        }
        const manifest = JSON.stringify({ buildId, builtAt: new Date().toISOString() });
        await writeFile(`${directory}/build-info.json`, manifest);
        this.emitFile({
          type: "asset",
          fileName: "build-info.json",
          source: manifest,
        });
      },
    },
  ],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2022",
    sourcemap: "hidden",
  },
});
