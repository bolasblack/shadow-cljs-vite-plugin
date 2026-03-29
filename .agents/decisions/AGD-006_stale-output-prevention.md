---
title: "Wait for initial build completion before serving virtual modules"
description: "In serve mode, wait for shadow-cljs watch to complete its first build before reading output files to prevent stale output"
tags: reliability, dev-experience
---

## Context

When running `pnpm start` a second time, `.shadow-cljs-out/app/main.js` already exists from the previous session. The plugin's `load()` hook checks `existsAsync(filePath)` and immediately reads the file if it exists.

But this file was compiled by a previous shadow-cljs instance. The current `shadow-cljs watch` hasn't finished its initial build yet. This causes shadow-cljs to warn:

> shadow-cljs - Stale Output! Your loaded JS was not produced by the running shadow-cljs instance.

## Decision

In the `load()` hook, when a shadow-cljs watch process is running (`getGlobalState()` is truthy), always `await waitForBuildComplete(buildId)` before reading the output file — even if the file already exists on disk.

```typescript
if (getGlobalState()) {
  await waitForBuildComplete(buildId);
}
```

`waitForBuildComplete` listens for the `"Build completed"` message parsed from shadow-cljs stdout, ensuring the current instance has written fresh output.

## Consequences

- First page load may be slightly slower (waits for shadow-cljs compilation)
- No stale output warnings
- Users always see code from the current shadow-cljs instance
- No impact on production builds (no shadow-cljs process running)
