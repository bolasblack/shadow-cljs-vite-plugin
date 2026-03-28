# shadow-cljs-vite-plugin

[![Tests](https://github.com/bolasblack/shadow-cljs-vite-plugin/actions/workflows/test.yml/badge.svg)](https://github.com/bolasblack/shadow-cljs-vite-plugin/actions/workflows/test.yml)

A robust Vite plugin for seamless integration with [shadow-cljs](https://github.com/thheller/shadow-cljs).

This plugin bridges the gap between the shadow-cljs build tool and the Vite dev server, allowing you to use Vite's lightning-fast HMR and rich ecosystem while developing ClojureScript applications.

## Features

- **Seamless Integration**: Automatically starts and manages the `shadow-cljs` process.
- **Hot Module Replacement (HMR)**: Correctly delegates HMR to shadow-cljs (for the browser runtime) for a smooth REPL-driven workflow.
- **Cloudflare Workers Ready**: Fully tested and works seamlessly with [`@cloudflare/vite-plugin`](https://github.com/cloudflare/workers-sdk/tree/main/packages/vite-plugin). Includes specialized logic to handle Google Closure Library namespaces in ESM environments.
- **Zero Configuration**: Works out of the box for most standard shadow-cljs setups.

## Installation

```bash
npm install -D shadow-cljs-vite-plugin
# or
pnpm add -D shadow-cljs-vite-plugin
```

## Usage

Add the plugin to your `vite.config.ts` (or `vite.config.js`).

```typescript
import { defineConfig } from "vite";
import { shadowCljs } from "shadow-cljs-vite-plugin";

export default defineConfig({
  plugins: [
    shadowCljs({
      buildIds: ["app"], // The build ID(s) from your shadow-cljs.edn
      configPath: "./shadow-cljs.edn", // Optional: Path to config
    }),
  ],
});
```

Then, import the virtual module in your entry HTML or JavaScript file (e.g., `main.tsx` or `index.html`):

```html
<!-- index.html -->
<script type="module">
  import "virtual:shadow-cljs/app"; // Matches the build ID provided in config
</script>
```

**Working examples:**

- [examples/cljs-ts-mixed/](./examples/cljs-ts-mixed/) — CLJS + TypeScript mixed project with HMR
- [examples/cljs-react/](./examples/cljs-react/) — CLJS business logic + React UI with HMR
- [examples/cljs-reagent/](./examples/cljs-reagent/) — Pure Reagent (ClojureScript) app with HMR
- [tests/e2e/fixtures/simple-project/](./tests/e2e/fixtures/simple-project/) — E2E test fixture (Cloudflare Workers)

## Shadow-CLJS Configuration Requirements

To ensure correct integration with Vite's ES module system and avoid runtime errors, your `shadow-cljs.edn` build configuration **MUST** use the following settings:

```edn
{:target :esm
 :js-options {:js-provider :import}}
```

- `:target :esm`: Tells shadow-cljs to output standard ES modules.
- `:js-options {:js-provider :import}`: Ensures that dependencies are imported using native ESM syntax.

## Configuration

### `buildIds` (Required)

- **Type**: `string[]`
- **Description**: The list of build IDs defined in your `shadow-cljs.edn` that you want Vite to handle.

### `configPath` (Optional)

- **Type**: `string`
- **Default**: `shadow-cljs.edn` in the project root.
- **Description**: The path to your shadow-cljs configuration file.

## Hot Module Replacement (HMR)

In dev mode, shadow-cljs handles hot-reloading of ClojureScript code via its own WebSocket + `eval()` mechanism. The plugin integrates with this by:

1. **Suppressing Vite's default HMR** for shadow-cljs output files (re-importing the CLJS module tree would break the stateful ClojureScript runtime).
2. **Auto-refreshing ES module live bindings** when shadow-cljs hot-reloads code, so consumers always see fresh values.
3. **Dispatching a `"shadow-cljs:hot-reload"` event** on `window` after exports are refreshed, so your app can re-render.

### Pure ClojureScript (Reagent, etc.)

Use shadow-cljs's standard `^:dev/after-load` hook to re-render:

```clojure
(defn ^:dev/after-load on-reload []
  (render)) ;; re-mount your root component
```

State in `defonce` atoms is preserved across reloads. See [examples/cljs-reagent/](./examples/cljs-reagent/) for a complete example.

### Mixed CLJS + TypeScript/JavaScript

When TypeScript/JavaScript code imports CLJS functions via `virtual:shadow-cljs/app`, the plugin generates ES module live bindings that stay fresh after hot-reload. Listen for the `"shadow-cljs:hot-reload"` event to re-render:

```typescript
import { greet, add } from "virtual:shadow-cljs/app";

function render() {
  // greet and add are always up-to-date after hot-reload
  document.getElementById("app")!.innerHTML = `${greet("World")} ${add(1, 2)}`;
}

render();

// Re-render when CLJS code changes
window.addEventListener("shadow-cljs:hot-reload", () => render());
```

See [examples/cljs-ts-mixed/](./examples/cljs-ts-mixed/) and [examples/cljs-react/](./examples/cljs-react/) for complete examples.

## How it Works

1.  **Dev Server**: When you run `vite`, this plugin spawns `shadow-cljs watch <build-id>`. Shadow-cljs handles file watching, recompilation, and hot-reload via its own WebSocket. The plugin suppresses Vite's default HMR for shadow-cljs output files and provides ES module live binding refresh + event dispatch for mixed CLJS/JS projects.
2.  **Production Build**: When you run `vite build`, it spawns `shadow-cljs release <build-id>` to generate the optimized assets, which Vite then bundles.

## Tests

This project includes a comprehensive test suite, including End-to-End (E2E) tests that simulate real-world build scenarios (including integration with Cloudflare Workers) to ensure reliability.

To run the tests locally:

```bash
pnpm test
```

## Projects using this plugin

- [bolasblack/BlogFront](https://github.com/bolasblack/BlogFront) - [https://blog.c4605.com](https://blog.c4605.com)

If you are using this project, feel free to submit a PR to add it here.

## Contributing

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for details on the code structure and how to submit changes.

## License

MIT
