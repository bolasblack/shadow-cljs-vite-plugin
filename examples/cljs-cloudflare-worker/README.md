# CLJS + Cloudflare Worker Example

Demonstrates using ClojureScript for both browser and Cloudflare Worker, sharing business logic between client and server.

## Architecture

```
shadow-cljs.edn
├── :browser  →  virtual:shadow-cljs/browser  →  React app (client)
└── :worker   →  virtual:shadow-cljs/worker   →  Cloudflare Worker (SSR)

Shared: app.shared (greet, add) used by both builds
```

- **Browser build**: React + CLJS business logic, served as static files
- **Worker build**: Cloudflare Worker that handles SSR and API routes
- **Shared code**: `app.shared` namespace used by both browser and worker

## Features

- `@cloudflare/vite-plugin` for Worker dev/deploy
- Shared CLJS business logic between client and server
- Worker SSR with `text/html` responses
- JSON API endpoint (`/api/greet`)
- HMR: edit `.cljs` files and see changes in both browser and worker

## Getting started

```bash
pnpm install
pnpm dev
```

- Browser app: http://localhost:5173
- Worker SSR: `curl http://localhost:5173/?name=Alice`
- API: `curl http://localhost:5173/api/greet?name=Alice`

## Deploy to Cloudflare

```bash
pnpm wrangler:deploy
```
