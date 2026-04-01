import type { PluginOption, ResolvedConfig } from "vite";
import { createBuildPlugin } from "./plugins/build";
import { createCljsEnvPatchPlugin } from "./plugins/cljsEnvPatch";
import { createServePlugin } from "./plugins/serve";
import { createVirtualModulePlugin } from "./plugins/virtualModule";
import type { PluginContext, ShadowCljsOptions } from "./types";
import { loadBuildConfigs, resolveConfigPath } from "./utils/shadowCljsConfig";

export type { ShadowCljsOptions } from "./types";

export function shadowCljs(options: ShadowCljsOptions): PluginOption[] {
  const { buildIds } = options;
  const ctx: Partial<PluginContext> = {};

  async function initContext(config: ResolvedConfig): Promise<void> {
    ctx.projectRoot = config.root;
    ctx.configPath = resolveConfigPath(ctx.projectRoot, options.configPath);
    ctx.buildConfigs = await loadBuildConfigs(ctx.configPath, buildIds);
  }

  function getContext(): PluginContext {
    return ctx as PluginContext;
  }

  const buildPlugin = createBuildPlugin(initContext, getContext, buildIds);
  const servePlugin = createServePlugin(initContext, getContext, buildIds);
  const virtualModulePlugin = createVirtualModulePlugin(
    initContext,
    getContext,
    options
  );
  const cljsEnvPatchPlugin = createCljsEnvPatchPlugin(
    initContext,
    getContext,
    options
  );

  // servePlugin must be before virtualModulePlugin so that shadow-cljs
  // is started (and global state is set) before virtualModule's
  // configureServer registers the build-complete listener.
  return [servePlugin, virtualModulePlugin, cljsEnvPatchPlugin, buildPlugin];
}
