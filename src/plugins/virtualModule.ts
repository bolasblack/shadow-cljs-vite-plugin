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
} from "../utils/virtual";

export function createVirtualModulePlugin(
  initContext: (config: ResolvedConfig) => Promise<void>,
  getContext: () => PluginContext,
  options: ShadowCljsOptions,
): PluginOption {
  return {
    name: "shadow-cljs:virtual-module",
    configResolved: initContext,

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

      // AGD-005: In serve mode for browser targets, generate HMR-aware wrapper
      // with live ES module bindings
      if (getGlobalState() && isBrowserTarget(buildConfig)) {
        return generateHmrAwareModule(content, filePath, hasDefaultExport);
      }

      return generateStaticModule(filePath, hasDefaultExport);
    },

    // AGD-004: Intercept HMR for shadow-cljs output files
    hotUpdate(hmrCtx) {
      const ctx = getContext();

      for (const buildConfig of ctx.buildConfigs.values()) {
        const outputDir = resolve(ctx.projectRoot, buildConfig.outputDir);
        if (!hmrCtx.file.startsWith(outputDir)) continue;

        // AGD-004: Browser targets — let shadow-cljs handle HMR via
        // WebSocket + eval. Re-importing the CLJS module tree would break
        // the stateful ClojureScript runtime (protocol dispatch tables, etc.)
        if (isBrowserTarget(buildConfig)) {
          return [];
        }

        // Non-browser targets: queue HMR update via Vite
        void sendHmrUpdate(getContext, hmrCtx.server, buildConfig.id);
        return [];
      }
    },
  };
}

// AGD-003: Static re-export for build mode
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
 * AGD-005: Generate HMR-aware wrapper with live ES module bindings.
 *
 * Parse `export let <name> = <expr>;` lines from shadow-cljs's main.js
 * and generate a wrapper module with mutable let-bindings.
 *
 * ES module `export { x }` with `let x` creates a live binding — when
 * `x` is reassigned, importers see the new value. We use this to keep
 * exports fresh after shadow-cljs hot-reloads code via eval().
 */
function generateHmrAwareModule(
  content: string,
  filePath: string,
  hasDefaultExport: boolean,
): string {
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
  const refreshBody = exports.map((e) => `  ${e.name} = ${e.expr};`).join("\n");

  // AGD-005: The generated wrapper:
  // 1. Imports main.js for side effects (loads CLJS runtime)
  // 2. Declares mutable let-bindings initialized from global namespace
  // 3. Re-exports via `export { }` which creates ES live bindings
  // 4. Hooks SHADOW_ENV.setLoaded to detect hot-reload and refresh bindings
  // 5. Dispatches "shadow-cljs:hot-reload" event for consumers to re-render
  return `
import "${filePath}";
${declarations}
export { ${names.join(", ")} };
${hasDefaultExport ? `export { default } from "${filePath}";\n` : ""}
if (import.meta.hot) {
  import.meta.hot.accept();

  // Detect shadow-cljs hot-reload by hooking SHADOW_ENV.setLoaded.
  // During initial page load, setLoaded is called synchronously for every
  // module (~100+ times). We skip those using a flag set after synchronous
  // execution completes (setTimeout 0). Only subsequent calls from
  // shadow-cljs WebSocket hot-reload trigger the refresh.
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
${refreshBody}
        window.dispatchEvent(new CustomEvent("shadow-cljs:hot-reload"));
      }, 50);
    };
  }
}
`.trim();
}
