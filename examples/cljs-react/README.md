# CLJS + React Example

Demonstrates using ClojureScript business logic in a React app with Vite HMR.

## Features

- **React components** in TypeScript import CLJS functions via `virtual:shadow-cljs/app`
- **Hot Module Replacement**: edit `.cljs` files and see changes instantly without losing React state
- The plugin auto-refreshes ES module live bindings when shadow-cljs hot-reloads code

## How it works

1. Edit `src/cljs/app/core.cljs` (e.g., change the greeting message)
2. shadow-cljs detects the change, recompiles, and hot-reloads via WebSocket + eval
3. The plugin detects the reload, refreshes ES module exports, and dispatches `"shadow-cljs:hot-reload"`
4. The React component listens for the event and re-renders with fresh values
5. React state (input values, etc.) is preserved across reloads

## Getting started

```bash
pnpm install
pnpm dev
```
