import { defineConfig } from "vite";
import { shadowCljs } from "../../../../src";

export default defineConfig({
  plugins: [
    shadowCljs({
      buildIds: ["app"],
    }),
  ],
});
