import path from "path";
import { defineConfig } from "vite";
import { shadowCljs } from "shadow-cljs-vite-plugin";

export default defineConfig({
  plugins: [
    shadowCljs({
      buildIds: ["app"],
    }),
  ],
  resolve: {
    alias: {
      "@ts": path.resolve(__dirname, "src/ts"),
    },
  },
});
