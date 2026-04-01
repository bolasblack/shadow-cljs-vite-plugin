import type { ViteDevServer } from "vite";
import { pDebounce } from "./pDebounce";
import type { PluginContext } from "../types";

const VIRTUAL_MODULE_PREFIX = "virtual:shadow-cljs/";

export type ShadowCljsVirtualId = string & { __shadowCljsVirtualId: true };

export function isShadowCljsVirtualModule(
  id: string,
): id is ShadowCljsVirtualId {
  return id.startsWith(`${VIRTUAL_MODULE_PREFIX}`);
}

export function toResolvedVirtualId(buildId: string): ShadowCljsVirtualId {
  return `\0${VIRTUAL_MODULE_PREFIX}${buildId}` as any;
}

export function parseBuildIdFromVirtualId(id: ShadowCljsVirtualId): string;
export function parseBuildIdFromVirtualId(id: string): string | null;
export function parseBuildIdFromVirtualId(id: string): string | null {
  if (id.startsWith(`\0${VIRTUAL_MODULE_PREFIX}`)) {
    return id.slice(`\0${VIRTUAL_MODULE_PREFIX}`.length);
  }
  return null;
}

/**
 * Send HMR update for a build.
 * Debounced to batch multiple file changes into a single HMR update.
 *
 * Note: Vite already invalidates the changed file and its importers chain
 * before calling hotUpdate. We only need to send the HMR update.
 */
export const sendHmrUpdate = pDebounce(
  (
    calls: [
      getCtx: () => PluginContext,
      server: ViteDevServer,
      buildId: string,
    ][],
  ) => {
    const [getCtx, server] = calls[calls.length - 1];
    const ctx = getCtx();
    const uniqueBuildIds = [...new Set(calls.map(([, , buildId]) => buildId))];

    for (const buildId of uniqueBuildIds) {
      const buildConfig = ctx.buildConfigs.get(buildId);
      if (!buildConfig) continue;

      const virtualId = toResolvedVirtualId(buildId);
      const timestamp = Date.now();

      // Send HMR update to each environment that has this module
      if (server.environments) {
        for (const devEnv of Object.values(server.environments)) {
          const virtualMod = devEnv.moduleGraph.getModuleById(virtualId);
          if (!virtualMod) continue;

          // Send HMR update - Vite already invalidated the changed files
          devEnv.hot.send({
            type: "update",
            updates: [
              {
                type: "js-update" as const,
                path: virtualMod.url,
                acceptedPath: virtualMod.url,
                timestamp,
              },
            ],
          });
        }
      }
    }
  },
  100,
);
