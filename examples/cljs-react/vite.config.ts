import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { shadowCljs } from "shadow-cljs-vite-plugin";

export default defineConfig({
  plugins: [
    shadowCljs({
      buildIds: ["app"],
    }),
    react(),
  ],
});
