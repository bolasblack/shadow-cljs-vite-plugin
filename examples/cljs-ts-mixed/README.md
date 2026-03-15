# CLJS + TypeScript Mixed Example

This example demonstrates how to use `shadow-cljs-vite-plugin` to build a mixed ClojureScript and TypeScript project, where:

- **ClojureScript** provides business logic, compiled by shadow-cljs
- **TypeScript** handles the UI and calls ClojureScript functions via virtual modules
- **Vite** manages the dev server, HMR, and final bundling

## Project Structure

```
src/
├── cljs/              # ClojureScript source (compiled by shadow-cljs)
│   └── app/
│       └── core.cljs
└── ts/                # TypeScript source (compiled by Vite)
    ├── main.ts        # Entry point, orchestrates both TS and CLJS
    ├── format.ts      # TS utility, shared with CLJS via Vite alias
    └── virtual-modules.d.ts  # Type declarations for CLJS exports
```

## How It Works

### TS → CLJS (via virtual module + `:exports`)

ClojureScript functions are exposed as ES module exports using the `:exports` map in `shadow-cljs.edn`:

```clojure
:modules {:main {:exports {greet app.core/greet
                            add app.core/add}}}
```

TypeScript imports them via the virtual module:

```typescript
import * as cljs from "virtual:shadow-cljs/app";
cljs.greet("World");
```

> **Note:** `:exports` is required. The `^:export` metadata in ClojureScript is a Closure Compiler directive that prevents symbol renaming during `:advanced` optimizations (so that external JS code can still reference the symbol by its original name) — it does **not** generate ES module `export` statements. You must explicitly list the functions you want to expose in the `:exports` map.

A `.d.ts` file (`virtual-modules.d.ts`) provides type safety for the CLJS exports.

### CLJS → TS (via Vite alias)

shadow-cljs with `:js-provider :import` preserves JS module specifiers as-is in its compiled output. We leverage this by configuring a Vite alias:

```typescript
// vite.config.ts
resolve: {
  alias: {
    "@ts": path.resolve(__dirname, "src/ts"),
  },
},
```

Then ClojureScript can require TypeScript modules using the alias:

```clojure
(ns app.core
  (:require ["@ts/format" :as fmt]))

(fmt/formatUpperCase "hello")
```

**How this works under the hood:**

1. shadow-cljs compiles and emits `import * as ... from "@ts/format"` (preserved as-is)
2. Vite processes the compiled output and resolves `@ts/format` → `src/ts/format.ts`
3. Vite compiles the TypeScript file and serves it

> **Note:** This works because `:js-provider :import` tells shadow-cljs not to resolve JS dependencies itself — it leaves them for the runtime/bundler (Vite in this case) to handle.

## Running

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Production build
pnpm build
```
