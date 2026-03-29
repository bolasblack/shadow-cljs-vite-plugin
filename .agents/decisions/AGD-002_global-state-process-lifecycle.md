---
title: "Global state for shadow-cljs process lifecycle management"
description: "Use globalThis singleton to manage the shadow-cljs child process across Vite restarts and plugin re-initializations"
tags: architecture, reliability
---

## Context

Vite can restart its dev server (e.g., when `shadow-cljs.edn` changes). Each restart re-runs plugin `configureServer` hooks, which would normally spawn a new shadow-cljs process — leaving the old one orphaned.

Shadow-cljs JVM startup is slow (~2-7s). Reusing an existing process across Vite restarts is desirable.

## Decision

Use a `globalThis` singleton (`__SHADOW_CLJS_VITE_PLUGIN_GLOBAL__`) to store:

- **`process`**: the shadow-cljs `ChildProcess`
- **`buildCompleteIds`**: Set of build IDs that have completed at least one build
- **`onBuildComplete`**: pub/sub listener for "Build completed" events (parsed from stdout)

### Process reuse
If `getGlobalState()?.process` exists when `configureServer` runs, skip spawning — reuse the existing process.

### Build completion detection
`handleShadowProcessOutputs` parses stdout/stderr line-by-line, matching `/\[:([a-z0-9-_]+)\] build completed/i` to detect when builds finish. This drives `waitForBuildComplete()` used by the virtual module `load()` hook.

### Detached process group
Shadow-cljs is spawned with `detached: true`, which places it in its own process group. This is critical because:

1. **Shadow-cljs spawns JVM child processes** (nREPL, file watcher, etc.) that must be cleaned up together
2. **`process.kill(-pid, signal)`** (negative pid) sends the signal to the entire process group — killing shadow-cljs AND all its JVM children in one call
3. **Detaching** prevents the shadow-cljs process group from receiving signals meant for the Vite parent process (e.g., Ctrl-C in terminal sends SIGINT to the foreground process group — without detaching, shadow-cljs would receive it too and exit uncontrollably)

### Graceful shutdown
`killProcess` sends `SIGINT` to the **process group** (`process.kill(-pid, "SIGINT")`). Falls back to `SIGKILL` after polling if the process doesn't exit. Windows uses `taskkill /T /F`.

## Consequences

- Shadow-cljs JVM survives Vite restarts — no cold restart penalty
- Build completion is detected via stdout parsing (fragile if shadow-cljs changes log format)
- Process group kill ensures no orphaned JVM processes
- The `detached: true` spawn option allows the process to outlive its parent if cleanup fails
