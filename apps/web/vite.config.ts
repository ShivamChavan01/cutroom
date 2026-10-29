import { defineConfig, loadEnv, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { assistantHandler } from "./server/assistant";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig(({ mode }) => {
  const installAssistant = (server: Pick<ViteDevServer, "middlewares">) => {
    const handler = assistantHandler({ ...loadEnv(mode, here("."), ""), ...process.env });
    server.middlewares.use((request, response, next) => {
      if (request.url?.startsWith("/api/assistant/")) void handler(request, response);
      else next();
    });
  };
  return {
    plugins: [react(), tailwindcss(), {
      name: "cutroom-assistant",
      configureServer: installAssistant,
      configurePreviewServer: installAssistant,
    }],
    server: { port: 5173 },
    build: {
      rollupOptions: {
        input: {
          main: here("./index.html"),
          perf: here("./perf.html"),
          headed: here("./headed.html"),
          merge: here("./merge.html"),
        },
      },
    },
  };
});
