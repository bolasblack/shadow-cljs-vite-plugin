---
title: "Poll-based HMR with client-server round-trip"
description: "Detect shadow-cljs eval completion by polling global namespace changes, then trigger React re-render via server round-trip"
tags: hmr, dev-experience
obsoletes: AGD-005
---

## Context

AGD-005 used `SHADOW_ENV.setLoaded` monkey-patch + `window.dispatchEvent("shadow-cljs:hot-reload")` to detect shadow-cljs eval completion and notify React. This required manual event listeners in user code (e.g., `App.tsx`).

This decision replaces that approach with an automatic, non-invasive mechanism.

## Decision

In dev mode for browser targets, the plugin uses a **poll-based client-server round-trip** for HMR:

### Generated wrapper module

```js
import "main.js";
let greet = app.core.greet;    // mutable let binding
export { greet };               // ES live binding — importers see reassignments

if (import.meta.hot) {
  // Poll globals after build-complete, refresh bindings, signal server
  const _getExports = () => [app.core.greet];
  import.meta.hot.on('shadow-cljs:build-complete', () => {
    const _prev = _getExports();
    let _n = 0;
    const _poll = () => {
      if (++_n > 400 || _getExports().some((v, i) => v !== _prev[i])) {
        greet = app.core.greet;  // refresh live binding
        import.meta.hot.send('shadow-cljs:eval-complete', {});
        return;
      }
      setTimeout(_poll, 5);
    };
    _poll();
  });
  import.meta.hot.accept();
}
```

### Server-side (configureServer)

1. `onBuildComplete` → sends `shadow-cljs:build-complete` custom event to browser
2. `env.hot.on('shadow-cljs:eval-complete')` → sends `js-update` for importers (App.tsx)

### HMR flow

```
shadow-cljs "Build completed" (stdout)
  → Server sends custom event 'shadow-cljs:build-complete'
    → Client polls: app.core.greet !== prev?
      → Yes (eval done): refresh let-bindings
        → Client sends 'shadow-cljs:eval-complete'
          → Server sends js-update for importers
            → React Fast Refresh re-renders ✅
```

### Key mechanisms

1. **`let` + `export {}`** creates ES module live bindings — reassignment propagates to importers immediately
2. **Poll-based eval detection** — compares global namespace values (every 5ms, max 2s timeout) instead of monkey-patching `SHADOW_ENV.setLoaded`
3. **Client refreshes bindings BEFORE signaling server** — ensures importers read fresh values when React re-renders
4. **Server sends `js-update` for importers only** — not for the virtual module itself (`\0`-prefixed virtual modules have URL mismatch issues with Vite's HMR client)
5. **`import.meta.hot.accept()`** absorbs any file-watcher leaks silently
6. **Watch-ignore patterns** from actual `output-dir` in shadow-cljs.edn (not hardcoded), added in `configResolved` before the watcher starts

### Approaches tried and rejected

#### 1. `SHADOW_ENV.setLoaded` hook (AGD-005's approach)

Monkey-patches `globalThis.SHADOW_ENV.setLoaded` to detect when shadow-cljs eval completes. A `setTimeout(0)` flag distinguishes initial load (~100+ calls) from hot-reload. A 50ms debounce batches multiple `setLoaded` calls into one notification:

```js
let _initialLoadComplete = false;
let _hmrTimer;
setTimeout(() => { _initialLoadComplete = true; }, 0);

const _origSetLoaded = globalThis.SHADOW_ENV?.setLoaded;
if (_origSetLoaded) {
  globalThis.SHADOW_ENV.setLoaded = function(name) {
    _origSetLoaded.call(globalThis.SHADOW_ENV, name);
    if (!_initialLoadComplete) return;
    clearTimeout(_hmrTimer);
    _hmrTimer = setTimeout(() => {
      greet = app.core.greet;  // refresh bindings
      import.meta.hot.send('shadow-cljs:eval-complete', {});
    }, 50);
  };
}
```

**Rejected because:**

- **Internal API.** `SHADOW_ENV.setLoaded` is shadow-cljs's internal module loading hook, not a public contract. It can change or disappear across versions.
- **Nested wrapping.** When the virtual module is re-executed (via `accept()`), the hook wraps the already-wrapped function, creating ever-deeper nesting. Multiple virtual modules (e.g., `:browser` + `:worker`) would each patch the same function, compounding the problem.
- **Double-firing in HMR loops.** If the HMR flow involves `accept()` → re-execute module → `invalidate()`, the module re-execution triggers shadow-cljs to call `setLoaded` for the re-imported modules. This creates a second batch of `setLoaded` calls (after the debounce of the first batch from the actual hot-reload eval). The result is two rounds of binding refresh + server notification per single edit, causing duplicate React re-renders.

#### 2. `import.meta.hot.invalidate()`

After the client-side custom event handler refreshes bindings, call `import.meta.hot.invalidate()` to propagate the change to importers (App.tsx) via Vite's HMR boundary system.

**Rejected because:** URL mismatch between client and server. The client sends `vite:invalidate` with path `/@id/__x00__virtual:shadow-cljs/app` (the browser-side URL), but the module in Vite's server-side module graph has `mod.url = virtual:shadow-cljs/app` (no `/@id/__x00__` prefix). Vite's internal invalidation handler looks up the module by the client-provided path and fails to find it — the invalidation is silently dropped. Confirmed by: server does receive the event (`env.hot.on('vite:invalidate')` fires), `mod.file` is not null (`virtual:shadow-cljs/app`), but no `js-update` is ever sent back. This is the same URL mismatch that prevents sending `js-update` for the virtual module directly (see #4).

#### 3. Fixed delay (100ms) after build-complete

Server waits a fixed time after "Build completed" before sending `js-update`, hoping shadow-cljs eval finishes within the delay.

**Rejected because:** Not deterministic. On fast machines with small changes, 100ms adds unnecessary latency. On slow machines or large recompilations, 100ms may not be enough — the user would see stale values with no recovery mechanism.

#### 4. Server sends `js-update` for the virtual module itself

Include the virtual module in the `js-update` message alongside importers, so `accept()` triggers re-execution with fresh globals.

**Rejected because:** URL mismatch between server and client. `mod.url` from Vite's module graph returns `virtual:shadow-cljs/app`, but the browser's HMR client registered the module under `/@id/__x00__virtual:shadow-cljs/app`. The browser ignores the update for the unrecognized URL — confirmed by browser logs showing only `[vite] hot updated: /src/tsx/App.tsx` with no mention of the virtual module.

#### 5. Custom event + immediate binding refresh (no poll)

Server sends `shadow-cljs:build-complete` custom event immediately after stdout detection. Client's `import.meta.hot.on()` handler refreshes bindings and then server sends `js-update` for importers.

**Rejected because:** Timing race. shadow-cljs's stdout "Build completed" and its WebSocket eval message are sent at roughly the same time, but the browser processes them on different WebSocket connections. In practice, our custom event arrives and refreshes bindings while shadow-cljs eval is still in progress — `app.core.greet` still references the old function. Browser logs confirmed the order: `shadow-cljs: reloading code` → `[vite] hot updated: /src/tsx/App.tsx` → `shadow-cljs: load JS app/core.cljs`.

#### 6. `Object.defineProperty` setter trap

Use property descriptors on the global namespace (e.g., `app.core.greet`) to intercept writes from shadow-cljs eval, triggering HMR on assignment.

**Rejected because:** Modifies the global object's property descriptors, which could break ClojureScript runtime assumptions (e.g., `Object.getOwnPropertyDescriptor` returning an accessor instead of a data property). Also requires `dispose()` cleanup on module re-execution to avoid stacking traps, and doesn't fire at all if the user's edit only changes a namespace that isn't directly exported.

## Consequences

- Users import CLJS functions normally: `import { greet } from "virtual:shadow-cljs/app"`
- After hot-reload, React re-renders automatically — **no manual event listeners needed**
- No CLJS code changes required (no `^:dev/after-load` needed for the plugin)
- No monkey-patching of shadow-cljs internals
- Polling overhead is negligible (only runs after build-complete, stops immediately on detection)
- In production builds, the standard `export * from "main.js"` is used (no wrapper)

## Known Issue: Vite virtual module URL mismatch

Virtual modules have inconsistent URLs between client and server in Vite 8:

- Browser-side URL: `/@id/__x00__virtual:shadow-cljs/app`
- Server-side `mod.url`: `virtual:shadow-cljs/app`

This mismatch causes two problems:

1. **`invalidate()` silently fails.** The client sends `vite:invalidate` with the browser-side URL. The server receives the event (confirmed via `env.hot.on('vite:invalidate')`), but Vite's internal handler can't resolve it back to the module. No `js-update` is produced.

2. **`js-update` for virtual modules is ignored.** Sending `js-update` with `mod.url` as the path doesn't match the browser's module registry. The browser silently skips it.

Both were confirmed experimentally. This is likely a Vite bug — `/@id/__x00__` encoding is Vite's own convention, and its internal handlers should be able to resolve it.

**Upstream PR:** https://github.com/vitejs/vite/pull/22098

**After the PR is merged**, the `eval-complete` round-trip can be eliminated. Simplified flow:

```
Server: build-complete → Client
Client: poll → refresh bindings → invalidate()
Vite auto-propagates to importers → React re-renders
```

Server-side `configureServer` simplifies to just sending the `build-complete` event:

```js
// Step 2 (eval-complete listener + js-update) is no longer needed
state.onBuildComplete((buildId) => {
  for (const env of Object.values(server.environments)) {
    env.hot.send("shadow-cljs:build-complete", { buildId });
  }
});
```

Client-side generated code replaces `import.meta.hot.send('eval-complete')` with `invalidate()`:

```js
import.meta.hot.on('shadow-cljs:build-complete', () => {
  const _prev = _getExports();
  const _poll = () => {
    if (changed || timeout) {
      greet = app.core.greet;                      // refresh bindings
      import.meta.hot.invalidate('shadow-cljs');   // Vite propagates to importers
      return;
    }
    setTimeout(_poll, 5);
  };
  _poll();
});
import.meta.hot.accept();
```

This removes the `eval-complete` listener, `js-update` sending logic, and the `toResolvedVirtualId` + `moduleGraph.getModuleById` lookups from the server.
