---
title: "Virtual module pattern for shadow-cljs ESM imports"
description: "Use Vite virtual modules (virtual:shadow-cljs/<buildId>) as the bridge between user code and shadow-cljs output"
tags: architecture
---

## Context

Shadow-cljs `:target :esm` writes output to a configurable directory (e.g., `.shadow-cljs-out/app/main.js`). User code needs a stable import specifier that doesn't depend on the output path.

## Decision

Use Vite's virtual module convention:

- **Import specifier**: `virtual:shadow-cljs/<buildId>` (e.g., `virtual:shadow-cljs/app`)
- **Resolved ID**: `\0virtual:shadow-cljs/app` (`\0` prefix per Vite convention to mark as virtual)
- **Module content**: re-exports from the actual shadow-cljs output file

```typescript
// resolveId
if (id === "virtual:shadow-cljs/app") return "\0virtual:shadow-cljs/app";

// load
return `export * from "${filePath}";`;  // filePath = .shadow-cljs-out/app/main.js
```

The `load()` hook reads the output file to detect `export default` and generates appropriate re-export syntax. In dev mode for browser targets, it generates an HMR-aware wrapper instead (AGD-005).

### Entry path resolution

The entry file path is derived from `shadow-cljs.edn` config:
```
{outputDir}/{firstModuleName}.js
```
e.g., `.shadow-cljs-out/app/main.js` for `:output-dir ".shadow-cljs-out/app"` with `:modules {:main ...}`.

## Consequences

- Users import a clean specifier: `import { greet } from "virtual:shadow-cljs/app"`
- The actual output path is an implementation detail
- Multiple builds are supported: `virtual:shadow-cljs/app`, `virtual:shadow-cljs/worker`, etc.
- Type safety via `.d.ts` declaration files for each virtual module
