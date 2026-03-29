import type { PluginOption, ResolvedConfig } from "vite";
import type { PluginContext, ShadowCljsOptions } from "../types";

export function createCljsEnvPatchPlugin(
  initContext: (config: ResolvedConfig) => Promise<void>,
  getContext: () => PluginContext,
  options: ShadowCljsOptions
): PluginOption {
  return {
    name: "shadow-cljs:cljs-env-patch",
    configResolved: initContext,
    enforce: "pre",

    async transform(code, id) {
      if (!id.includes("cljs-runtime/")) return;

      // Always inject the patch into cljs_env.js
      if (id.includes("cljs_env.js")) {
        return code + GOOG_IDEMPOTENT_PATCH;
      }

      return code;
    },
  };
}

/**
 * AGD-001: Appended to cljs_env.js to make goog.provide/goog.module idempotent.
 *
 * Why this is needed:
 * Vite's HMR re-executes module code when files change, but globalThis state
 * (like goog.loadedModules_) persists across HMR updates. Google Closure Library
 * assumes modules are loaded exactly once and throws "Namespace already declared"
 * errors on duplicate registration. This patch makes the registration idempotent.
 *
 * Shadow-cljs patch-goog! does similar things:
 * - goog.provide -> goog.constructNamespace_
 * - goog.require -> goog.module.get
 *
 * Reference: shadow-cljs src/main/shadow/cljs/devtools/client/env.cljs
 * https://github.com/thheller/shadow-cljs/blob/46f8988ba6a5f1e8f67f9a9ecf1bac5656e0a8ed/src/main/shadow/cljs/devtools/client/env.cljs#L152-L161
 */
const GOOG_IDEMPOTENT_PATCH = `
;(function() {
  if (goog.__shadowCljsIdempotentPatched__) return;
  goog.__shadowCljsIdempotentPatched__ = true;

  // Make provide idempotent
  goog.provide = function(name) {
    return goog.isProvided_(name) ? undefined : goog.constructNamespace_.call(this, name);
  };

  // Use module.get for require (shadow-cljs convention)
  goog.require = goog.module.get;

  // Make module idempotent for HMR compatibility
  var origModule = goog.module;
  goog.module = Object.assign(function(name) {
    if (name in goog.loadedModules_) {
      goog.moduleLoaderState_.moduleName = name;
      return;
    }
    return origModule.call(this, name);
  }, origModule);
})();
`;
