import * as fs from "fs/promises";
import { sep as pathSep, resolve } from "path";
import type { PluginOption, ResolvedConfig } from "vite";
import { TAG } from "../constants";
import type { PluginContext, ShadowCljsOptions } from "../types";
import { existsAsync } from "../utils/existsAsync";
import {
  getEntryPath,
  isBrowserTarget,
  resolveConfigPath,
} from "../utils/shadowCljsConfig";
import {
  getGlobalState,
  waitForBuildComplete,
} from "../utils/shadowCljsProcess";
import {
  isShadowCljsVirtualModule,
  parseBuildIdFromVirtualId,
  toResolvedVirtualId,
} from "../utils/virtual";

export function createVirtualModulePlugin(
  initContext: (config: ResolvedConfig) => Promise<void>,
  getContext: () => PluginContext,
  options: ShadowCljsOptions
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

      while (!(await existsAsync(filePath))) {
        if (!getGlobalState()) {
          throw new Error(
            `Build output file not found: ${filePath}.\nEnsure shadow-cljs release succeeded.`
          );
        }
        await waitForBuildComplete(buildId);
      }

      const content = await fs.readFile(filePath, "utf-8");
      const appendContent = isBrowserTarget(buildConfig)
        ? /* delegate HMR to shadow-cljs */ PREVENT_VITE_HMR_FULL_RELOAD
        : "";

      if (/\bexport default /m.test(content)) {
        return `export * from "${filePath}";\nexport { default } from "${filePath}";\n${appendContent}`;
      }

      return `export * from "${filePath}";\n${appendContent}`;
    },

    configureServer(server) {
      const configPath = resolveConfigPath(
        server.config.root ?? process.cwd(),
        options.configPath
      );

      let restartPromise: Promise<void> | null = null;
      server.watcher.add(configPath);
      server.watcher.on("change", (file: string) => {
        if (file !== configPath) return;
        if (restartPromise) return;
        restartPromise = server
          .restart(true)
          .catch((error) => {
            console.warn(`${TAG} Failed to restart Vite server:`, error);
          })
          .finally(() => {
            restartPromise = null;
          });
      });

      const handleFileChange = (file: string) => {
        const ctx = getContext();
        if (!ctx.buildConfigs) return;

        for (const buildConfig of ctx.buildConfigs.values()) {
          const outputDir = resolve(ctx.projectRoot, buildConfig.outputDir);
          const entryPath = getEntryPath(ctx.projectRoot, buildConfig);
          const isEntry = file === entryPath;
          const isInOutputDir = file.startsWith(`${outputDir}${pathSep}`);

          if (!isEntry && !isInOutputDir) continue;

          const mod = server.moduleGraph.getModuleById(
            toResolvedVirtualId(buildConfig.id)
          );
          if (mod) {
            server.moduleGraph.invalidateModule(mod);
          }
        }
      };

      server.watcher.on("add", handleFileChange);
      server.watcher.on("change", handleFileChange);
      server.watcher.on("unlink", handleFileChange);
    },
  };
}

const PREVENT_VITE_HMR_FULL_RELOAD = `
;(function() {
  if (import.meta.hot) {
    import.meta.hot.accept(() => {});
  }
})();
`;
