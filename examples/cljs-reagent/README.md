# CLJS Reagent Example

A pure Reagent (ClojureScript) app served through Vite.

## Features

- **All UI in ClojureScript** using Reagent components
- **HMR via shadow-cljs**: edit `.cljs` files and see changes instantly
- **State preserved**: `defonce` atoms keep their values across hot-reloads
- Reagent's `^:dev/after-load` hook re-renders the root component after reload

## How it works

1. Vite serves `index.html` which loads `main.js`
2. `main.js` imports `virtual:shadow-cljs/app` (side-effect: mounts Reagent app)
3. Edit `src/cljs/app/core.cljs` — shadow-cljs hot-reloads via eval
4. `^:dev/after-load render` re-renders the root component
5. Reagent diffs the virtual DOM and updates only what changed
6. `defonce` state (counter, input) is preserved

## Getting started

```bash
pnpm install
pnpm dev
```
