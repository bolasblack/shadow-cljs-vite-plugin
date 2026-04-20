import * as fs from "fs/promises";
import { resolve } from "path";
import type { PluginOption, ResolvedConfig } from "vite";
import type { PluginContext, ShadowCljsOptions } from "../types";
import { existsAsync } from "../utils/existsAsync";
import { getEntryPath, isBrowserTarget } from "../utils/shadowCljsConfig";
import {
  getGlobalState,
  waitForBuildComplete,
} from "../utils/shadowCljsProcess";
import {
  isShadowCljsVirtualModule,
  parseBuildIdFromVirtualId,
  sendHmrUpdate,
  toResolvedVirtualId,
} from "../utils/virtual";

export function createVirtualModulePlugin(
  initContext: (config: ResolvedConfig) => Promise<void>,
  getContext: () => PluginContext,
  options: ShadowCljsOptions,
): PluginOption {
  return {
    name: "shadow-cljs:virtual-module",

    // Populate context AND add watch-ignore patterns for the actual
    // output directories.  This must happen in configResolved (not
    // config) because we need the build configs from shadow-cljs.edn,
    // and it must happen before the watcher is created.
    async configResolved(config) {
      await initContext(config);

      if (config.command !== "serve") return;

      const ctx = getContext();
      if (!ctx.buildConfigs) return;

      // Append output-dir matchers to server.watch.ignored.
      // The watcher is created AFTER configResolved, so the
      // resolved config still accepts mutations here.
      const watchOpts = (config as any).server?.watch;
      if (!watchOpts) return;
      const ignored: unknown[] = Array.isArray(watchOpts.ignored)
        ? watchOpts.ignored
        : watchOpts.ignored
          ? [watchOpts.ignored]
          : [];

      for (const bc of ctx.buildConfigs.values()) {
        const absDir = resolve(config.root, bc.outputDir);
        ignored.push((path: string) => path.startsWith(absDir));
      }
      watchOpts.ignored = ignored;
    },

    // AGD-003: Virtual module pattern — resolve virtual:shadow-cljs/<buildId>
    async resolveId(id) {
      if (!isShadowCljsVirtualModule(id)) return;
      return `\0${id}`;
    },

    // AGD-003: Virtual module pattern — load shadow-cljs output as ES module
    async load(id) {
      const buildId = parseBuildIdFromVirtualId(id);
      if (!buildId) return;

      const ctx = getContext();
      if (!ctx.buildConfigs) {
        throw new Error("shadow-cljs plugin not initialized");
      }

      const buildConfig = ctx.buildConfigs.get(buildId);
      if (!buildConfig) {
        throw new Error(`Build '${buildId}' not found in shadow-cljs config`);
      }

      const filePath = getEntryPath(ctx.projectRoot, buildConfig);

      // AGD-006: Wait for initial build completion to prevent stale output
      if (getGlobalState()) {
        await waitForBuildComplete(buildId);
      }

      while (!(await existsAsync(filePath))) {
        if (!getGlobalState()) {
          throw new Error(
            `Build output file not found: ${filePath}.\nEnsure shadow-cljs release succeeded.`,
          );
        }
        await waitForBuildComplete(buildId);
      }

      const content = await fs.readFile(filePath, "utf-8");
      const hasDefaultExport = /\bexport default /m.test(content);

      // In serve mode for browser targets, read from global namespace
      // instead of re-exporting from main.js (see generateGlobalNamespaceModule)
      if (getGlobalState() && isBrowserTarget(buildConfig)) {
        return generateGlobalNamespaceModule(
          content,
          filePath,
          hasDefaultExport,
          buildId,
        );
      }

      return generateStaticModule(filePath, hasDefaultExport);
    },

    configureServer(server) {
      const state = getGlobalState();
      if (!state) return;

      const ctx = getContext();
      const unsubscribes: (() => void)[] = [];

      // --- Step 1: On build-complete, notify the client ---
      for (const buildConfig of ctx.buildConfigs.values()) {
        if (!isBrowserTarget(buildConfig)) continue;

        // Seed from existing completion state so we don't swallow the first
        // real edit after a Vite restart (AGD-002 reuses the shadow-cljs
        // process across restarts, so buildCompleteIds persists).
        let initialBuildDone = state.buildCompleteIds.has(buildConfig.id);
        const unsub = state.onBuildComplete((buildId) => {
          if (buildId !== buildConfig.id) return;
          if (!initialBuildDone) {
            initialBuildDone = true;
            return;
          }
          // Signal the client that a build completed.  The client polls
          // for global-namespace changes (shadow-cljs eval) and replies
          // with 'shadow-cljs:eval-complete' when ready.
          for (const env of Object.values(server.environments)) {
            env.hot.send("shadow-cljs:build-complete", { buildId });
          }
        });
        unsubscribes.push(unsub);
      }

      // --- Step 2: On eval-complete (from client), send js-update ---
      for (const env of Object.values(server.environments)) {
        env.hot.on?.("shadow-cljs:eval-complete", (payload?: { buildId?: string }) => {
          // Filter by buildId so multi-build projects don't re-render
          // importers of builds that didn't change.
          const onlyBuildId = payload?.buildId;
          for (const buildConfig of ctx.buildConfigs.values()) {
            if (onlyBuildId && buildConfig.id !== onlyBuildId) continue;
            if (!isBrowserTarget(buildConfig)) continue;
            const virtualId = toResolvedVirtualId(buildConfig.id);
            const mod = env.moduleGraph.getModuleById(virtualId);
            if (!mod) continue;
            const timestamp = Date.now();
            // The client already refreshed the virtual module's
            // let-bindings (live ES module exports).  We only need to
            // trigger importers to re-render with the fresh exports.
            const updates: any[] = [];
            for (const importer of mod.importers) {
              updates.push({
                type: "js-update" as const,
                path: importer.url,
                acceptedPath: importer.url,
                timestamp,
              });
            }
            if (updates.length > 0) {
              env.hot.send({ type: "update", updates });
            }
          }
        });
      }

      server.httpServer?.once("close", () => {
        unsubscribes.forEach((fn) => fn());
      });
    },

    // Intercept HMR for shadow-cljs output files
    hotUpdate(hmrCtx) {
      const ctx = getContext();

      for (const buildConfig of ctx.buildConfigs.values()) {
        const outputDir = resolve(ctx.projectRoot, buildConfig.outputDir);
        if (!hmrCtx.file.startsWith(outputDir)) continue;

        if (isBrowserTarget(buildConfig)) {
          return [];
        }

        void sendHmrUpdate(getContext, hmrCtx.server, buildConfig.id);
        return [];
      }
    },
  };
}

/**
 * Static re-export — used in build mode and for non-browser targets.
 *
 * Generates `export * from "main.js"`, which directly re-exports the
 * bindings from shadow-cljs's output module.  This is sufficient when
 * the module is loaded once and never hot-reloaded.
 */
function generateStaticModule(
  filePath: string,
  hasDefaultExport: boolean,
): string {
  const defaultPart = hasDefaultExport
    ? `export { default } from "${filePath}";\n`
    : "";
  return `export * from "${filePath}";\n${defaultPart}`;
}

/**
 * Global-namespace re-export — used in dev mode for browser targets.
 *
 * Unlike {@link generateStaticModule} which re-exports from the module
 * (`export * from "main.js"`), this reads values from the **global
 * namespace** (e.g. `app.core.greet`).  The distinction matters because:
 *
 * - shadow-cljs hot-reloads code via WebSocket + eval(), which updates
 *   the global namespace in-place but does NOT re-execute the ES module.
 * - We intentionally don't invalidate main.js in Vite's module graph
 *   (re-importing it would re-execute the CLJS module tree and break
 *   the stateful runtime: protocol dispatch tables, atoms, etc.).
 * - So `export *` would still point to the stale cached module bindings.
 *   Reading from the global namespace picks up the values that shadow-cljs
 *   eval'd.
 *
 * For HMR, the server and client cooperate via a round-trip:
 * 1. Server detects "Build completed" → sends `shadow-cljs:build-complete`
 *    custom event to the client.
 * 2. Client polls the global namespace (every 5ms, max 2s timeout) until
 *    the exported values change — meaning shadow-cljs eval completed.
 * 3. Client refreshes the `let` bindings (live ES module exports) and
 *    sends `shadow-cljs:eval-complete` back to the server.
 * 4. Server responds with `js-update` for importers — React Fast
 *    Refresh re-renders and reads the now-fresh live exports.
 *
 * This avoids fixed delays and monkey-patching internal APIs — the poll
 * detects the actual global-namespace mutation caused by shadow-cljs eval.
 */
export function generateGlobalNamespaceModule(
  content: string,
  filePath: string,
  hasDefaultExport: boolean,
  buildId: string,
): string {
  // Parse `export let greet = app.core.greet;` lines from shadow-cljs output
  const exportPattern = /^export let (\w+) = (.+);$/gm;
  const exports: { name: string; expr: string }[] = [];
  let match;
  while ((match = exportPattern.exec(content)) !== null) {
    exports.push({ name: match[1], expr: match[2] });
  }

  if (exports.length === 0) {
    return generateStaticModule(filePath, hasDefaultExport);
  }

  const names = exports.map((e) => e.name);
  const declarations = exports
    .map((e) => `let ${e.name} = ${e.expr};`)
    .join("\n");
  const buildIdLiteral = JSON.stringify(buildId);

  return `
import "${filePath}";
${declarations}
export { ${names.join(", ")} };
${hasDefaultExport ? `export { default } from "${filePath}";\n` : ""}
if (import.meta.hot) {
  // Poll for global-namespace changes after shadow-cljs build completes.
  // shadow-cljs sends compiled code via its own WebSocket; eval updates
  // the globals.  We detect completion by comparing current globals to
  // pre-build snapshot, then signal the server to send js-update.
  const _BUILD_ID = ${buildIdLiteral};
  const _getExports = () => [${exports.map((e) => e.expr).join(", ")}];
  import.meta.hot.on('shadow-cljs:build-complete', (e) => {
    if (e?.buildId !== _BUILD_ID) return;
    const _prev = _getExports();
    let _n = 0;
    const _poll = () => {
      if (_getExports().some((v, i) => v !== _prev[i])) {
        // Refresh let-bindings from globals BEFORE signaling the server,
        // so importers see fresh values when React re-renders.
${exports.map((e) => `        ${e.name} = ${e.expr};`).join("\n")}
        import.meta.hot.send('shadow-cljs:eval-complete', { buildId: _BUILD_ID });
        return;
      }
      if (++_n > 400) {
        // Timeout: shadow-cljs eval hasn't landed within 2s.  Surface it
        // instead of silently shipping stale globals to importers.
        console.warn('[shadow-cljs] build ' + _BUILD_ID + ' eval did not complete within 2s \u2014 UI may be stale until the next edit.');
        return;
      }
      setTimeout(_poll, 5);
    };
    _poll();
  });

  // Self-accept: on js-update the module is re-fetched and re-executed,
  // so the let-bindings re-read from the (now updated) global namespace.
  // Also absorbs file-watcher leaks so they don't propagate to importers.
  import.meta.hot.accept();
}
`.trim();
}
