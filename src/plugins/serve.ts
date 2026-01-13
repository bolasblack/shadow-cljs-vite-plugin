import type { PluginOption, ResolvedConfig } from "vite";
import { TAG } from "../constants";
import {
  getGlobalState,
  handleShadowProcessOutputs,
  setGlobalShadowProcess,
  spawnShadowCljs,
  stopGlobalShadowProcess,
} from "../utils/shadowCljsProcess";
import type { PluginContext } from "../types";
import { waitForProcessSpawn } from "../utils/waitForProcessSpawn";
import { toResolvedVirtualId } from "../utils/virtual";

export function createServePlugin(
  initContext: (config: ResolvedConfig) => Promise<void>,
  getContext: () => PluginContext,
  buildIds: string[]
): PluginOption {
  return {
    name: "shadow-cljs:serve",
    configResolved: initContext,
    apply: "serve",

    async configureServer(server) {
      const { projectRoot } = getContext();

      const shadowProcess = getGlobalState()?.process;
      if (shadowProcess) {
        console.log(`${TAG} Using existing shadow-cljs process...`);
        handleShadowProcessOutputs(shadowProcess);
        return;
      }

      console.log(`${TAG} Starting shadow-cljs watch...`);
      const newShadowProcess = spawnShadowCljs(["watch", ...buildIds], {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: projectRoot,
      });

      try {
        await waitForProcessSpawn(newShadowProcess);
      } catch (error) {
        console.error(`${TAG} Failed to start shadow-cljs`, error);
        throw error;
      }

      setGlobalShadowProcess(newShadowProcess, projectRoot);
      handleShadowProcessOutputs(newShadowProcess);

      const unlisten = getGlobalState()!.onBuildComplete((buildId) => {
        const mod = server.moduleGraph.getModuleById(
          toResolvedVirtualId(buildId)
        );
        if (mod) {
          server.moduleGraph.invalidateModule(mod);
        }
      });

      process.once("exit", () => {
        stopGlobalShadowProcess();
        unlisten();
      });
    },
  };
}
