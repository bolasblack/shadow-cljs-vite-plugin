---
title: Live ES module bindings for mixed CLJS+TS HMR
description: Generate a wrapper module with mutable let-bindings and SHADOW_ENV.setLoaded hook to auto-refresh exports after shadow-cljs hot-reload
tags: hmr, dev-experience
obsoleted_by: AGD-007
---


## Context

Per AGD-004, shadow-cljs handles HMR by eval'ing new code, which updates the global namespace. But ES module exports are snapshots:

```js
// shadow-cljs output (main.js)
export let greet = app.core.greet;  // captured at module load time
```

After shadow-cljs eval, `app.core.greet` is a new function, but the ES module export `greet` still points to the old one. TypeScript consumers see stale values.

Alternatives considered:
- **Vite HMR re-import**: breaks CLJS runtime (AGD-004)
- **User reads from globalThis**: works but ugly (`globalThis.app.core.greet`)
- **User adds `^:dev/after-load` hook**: clean but requires user to know plugin internals

## Decision

In dev mode for browser targets, the plugin generates an HMR-aware wrapper instead of `export * from "main.js"`:

```js
import "main.js";
let greet = app.core.greet;    // mutable let binding
export { greet };               // ES live binding — importers see reassignments

if (import.meta.hot) {
  import.meta.hot.accept();
  // Hook SHADOW_ENV.setLoaded to detect hot-reload (skip initial load via _ready flag)
  // On reload: reassign let bindings + dispatch "shadow-cljs:hot-reload" event
}
```

Key mechanisms:
1. **`let` + `export {}`** creates ES module live bindings — reassignment propagates to importers
2. **`SHADOW_ENV.setLoaded` hook** detects shadow-cljs reload without requiring user CLJS code
3. **`_ready` flag** skips the ~100+ `setLoaded` calls during initial synchronous module load
4. **Debounced (50ms)** to batch multiple namespace reloads into one refresh
5. **`"shadow-cljs:hot-reload"` event** dispatched on `window` for consumers to re-render
6. Export names are parsed from `main.js` via regex (`/^export let (\w+) = (.+);$/gm`)

In production builds, the standard `export * from "main.js"` is used (no wrapper).

## Consequences

- Users import CLJS functions normally: `import { greet } from "virtual:shadow-cljs/app"`
- After hot-reload, values are automatically fresh — no `getCljs()` or global namespace access
- Users only need `window.addEventListener("shadow-cljs:hot-reload", render)` to re-render
- No CLJS code changes required (no `^:dev/after-load` needed for the plugin's benefit)
- Monkey-patches `SHADOW_ENV.setLoaded` — acceptable since it's shadow-cljs ESM output's public interface
