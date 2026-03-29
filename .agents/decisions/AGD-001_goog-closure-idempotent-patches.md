---
title: "Patch Google Closure Library for idempotent module registration"
description: "Make goog.provide/goog.require/goog.module idempotent to survive Vite's HMR re-execution"
tags: hmr, architecture
---

## Context

Shadow-cljs `:target :esm` outputs code that uses Google Closure Library's module system (`goog.provide`, `goog.require`, `goog.module`). These functions assume modules are loaded exactly once and throw "Namespace already declared" on duplicate registration.

Vite's HMR re-executes module code when files change. Since `globalThis` state (like `goog.loadedModules_`) persists across HMR updates, the second execution hits the duplicate check.

Shadow-cljs itself does similar patching in its devtools client (`patch-goog!` in `env.cljs`).

## Decision

The `cljsEnvPatch` plugin (`enforce: "pre"`) appends a self-executing function to `cljs_env.js` that:

1. **`goog.provide`** → skip if namespace already provided, otherwise call `goog.constructNamespace_`
2. **`goog.require`** → replace with `goog.module.get` (returns already-loaded module)
3. **`goog.module`** → skip if module already in `goog.loadedModules_`, otherwise call original

A guard flag (`goog.__shadowCljsIdempotentPatched__`) ensures the patch is applied only once.

## Consequences

- Vite HMR can re-execute CLJS runtime files without "Namespace already declared" errors
- The patch runs before any other transforms (`enforce: "pre"`)
- Only applied to files matching `cljs-runtime/cljs_env.js`
