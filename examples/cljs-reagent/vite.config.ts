import { defineConfig } from "vite";
import { shadowCljs } from "shadow-cljs-vite-plugin";

export default defineConfig({
  plugins: [
    shadowCljs({
      buildIds: ["app"],
    }),
  ],
});
