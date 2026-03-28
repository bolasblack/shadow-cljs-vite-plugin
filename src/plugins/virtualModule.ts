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

    async resolveId(id) {
      if (!isShadowCljsVirtualModule(id)) return;
      return `\0${id}`;
    },

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

      // In serve mode (shadow-cljs watch running), always wait for the
      // current instance to complete its first build before reading.
      // This prevents loading stale output from a previous session,
      // which causes shadow-cljs "Stale Output!" warnings.
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

      // In serve mode for browser targets, generate a wrapper with mutable
      // let-bindings so ES module live bindings stay fresh after shadow-cljs
      // hot-reloads code via eval(). Without this, consumers would see stale
      // snapshot values from the initial module load.
      if (getGlobalState() && isBrowserTarget(buildConfig)) {
        return generateHmrAwareModule(content, filePath, hasDefaultExport);
      }

      return generateStaticModule(filePath, hasDefaultExport);
    },

    // Intercept HMR for shadow-cljs output files
    hotUpdate(hmrCtx) {
      const ctx = getContext();

      for (const buildConfig of ctx.buildConfigs.values()) {
        const outputDir = resolve(ctx.projectRoot, buildConfig.outputDir);
        if (!hmrCtx.file.startsWith(outputDir)) continue;

        // Browser targets: let shadow-cljs handle HMR, skip Vite's HMR
        if (isBrowserTarget(buildConfig)) {
          return [];
        }

        // Non-browser targets: queue HMR update
        // The file is already invalidated by Vite, just queue our HMR update
        void sendHmrUpdate(getContext, hmrCtx.server, buildConfig.id);

        // Return empty array to prevent Vite's default HMR (full reload)
        return [];
      }
    },
  };
}

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
  // Parse export lines: `export let greet = app.core.greet;`
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

  return `
import "${filePath}";
${declarations}
export { ${names.join(", ")} };
${hasDefaultExport ? `export { default } from "${filePath}";\n` : ""}
if (import.meta.hot) {
  import.meta.hot.accept();

  // Auto-detect shadow-cljs hot-reload by hooking SHADOW_ENV.setLoaded.
  // During initial page load, setLoaded is called synchronously for every
  // module. We skip those using a flag set after synchronous execution.
  // Only subsequent calls (from shadow-cljs WebSocket hot-reload) trigger
  // the export refresh + event dispatch.
  let _hmrTimer;

  const _origSetLoaded = globalThis.SHADOW_ENV?.setLoaded;
  if (_origSetLoaded) {
    globalThis.SHADOW_ENV.setLoaded = function(name) {
      _origSetLoaded.call(globalThis.SHADOW_ENV, name);
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
