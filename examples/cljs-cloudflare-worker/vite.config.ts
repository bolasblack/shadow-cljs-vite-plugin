import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { shadowCljs } from "shadow-cljs-vite-plugin";

export default defineConfig({
  plugins: [
    shadowCljs({
      buildIds: ["browser", "worker"],
    }),
    react(),
    cloudflare({
      viteEnvironment: { name: "ssr" },
      config: {
        main: "virtual:shadow-cljs/worker",
      },
    }),
  ],
});
