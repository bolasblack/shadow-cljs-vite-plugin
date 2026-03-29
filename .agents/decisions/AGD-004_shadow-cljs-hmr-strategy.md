---
title: "Shadow-cljs ESM HMR: delegate to shadow-cljs, suppress Vite"
description: "For browser-target ESM builds, let shadow-cljs handle HMR via WebSocket + eval instead of Vite's module re-import"
tags: hmr, architecture
---

## Context

The plugin bridges shadow-cljs `:target :esm` output with Vite's dev server. When CLJS source files change, both shadow-cljs and Vite could potentially handle HMR:

- **Vite's approach**: re-import the ES module tree with cache-busting timestamps
- **Shadow-cljs's approach**: push updated code via WebSocket, eval it in the browser to update the global namespace

We discovered that **Vite's approach breaks ClojureScript** because re-importing the entire CLJS module tree re-initializes the stateful runtime (protocol dispatch tables, atoms, `cljs.core`), causing errors like `No protocol method ISwap.-swap! defined for type cljs.core/Atom`.

## Decision

For browser-target ESM builds in dev mode:

1. **Suppress Vite's default HMR** for shadow-cljs output files (`hotUpdate` returns `[]`)
2. **Let shadow-cljs handle code reload** via its own WebSocket + `eval()` mechanism
3. **Append `import.meta.hot.accept()`** to the virtual module to prevent Vite full-page reload
4. For non-browser targets (SSR/workers), continue using Vite's HMR via `sendHmrUpdate`

## Consequences

- Shadow-cljs's eval updates the global namespace (`app.core.greet` etc.) but ES module `export let greet = app.core.greet` is a snapshot — won't auto-update
- This necessitates AGD-005 (live binding wrapper) for mixed CLJS+TS projects
- Pure CLJS apps (Reagent etc.) are unaffected — they use `^:dev/after-load` hooks to re-render from the global namespace directly
