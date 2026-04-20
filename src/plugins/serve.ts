import { spawn } from "child_process";
import type { PluginOption, ResolvedConfig, ViteDevServer } from "vite";
import { TAG } from "../constants";
import type { PluginContext } from "../types";
import { resolveConfigPath } from "../utils/shadowCljsConfig";
import {
  getGlobalState,
  handleShadowProcessOutputs,
  setGlobalShadowProcess,
  stopGlobalShadowProcess,
} from "../utils/shadowCljsProcess";
import { waitForProcessSpawn } from "../utils/waitForProcessSpawn";

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
      const { projectRoot, configPath } = getContext();

      autoRestartViteWhenShadowCljsFileChanged(server, configPath);

      // AGD-002: Reuse existing shadow-cljs process across Vite restarts
      const shadowProcess = getGlobalState()?.process;
      if (shadowProcess) {
        console.log(`${TAG} Using existing shadow-cljs process...`);
        return;
      }

      // AGD-002: Spawn in a detached process group so we can kill
      // shadow-cljs AND its JVM children together via process.kill(-pid)
      console.log(`${TAG} Starting shadow-cljs watch...`);
      const newShadowProcess = spawn("shadow-cljs", ["watch", ...buildIds], {
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
        cwd: projectRoot,
      });

      try {
        await waitForProcessSpawn(newShadowProcess);
      } catch (error) {
        console.error(`${TAG} Failed to start shadow-cljs`, error);
        throw error;
      }

      setGlobalShadowProcess(newShadowProcess);
      const unlistenShadowProcessOutputs =
        handleShadowProcessOutputs(newShadowProcess);

      // Last-resort SIGKILL — force mode has no `await`, so the
      // SIGKILL is sent synchronously before the process terminates.
      const onProcessExit = () =>
        void stopGlobalShadowProcess({ force: true });

      // Signal cleanup — pnpm may kill us at any await, so use force.
      // force mode sends SIGKILL synchronously (no await), then we exit.
      const onSignal = () => {
        void stopGlobalShadowProcess({ force: true });
        process.exit(0);
      };

      // Detach process-level listeners on cleanup — otherwise Vite restarts
      // (auto-restart on shadow-cljs.edn changes) re-invoke configureServer
      // and the handlers accumulate past MaxListeners.
      const cleanup = async (opts?: { force?: boolean }) => {
        process.off("exit", onProcessExit);
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
        await stopGlobalShadowProcess(opts);
        unlistenShadowProcessOutputs();
      };

      server.httpServer?.once("close", () => void cleanup());
      process.once("exit", onProcessExit);
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);
    },
  };
}

function autoRestartViteWhenShadowCljsFileChanged(
  server: ViteDevServer,
  configPathOption: string
) {
  const configPath = resolveConfigPath(
    server.config.root ?? process.cwd(),
    configPathOption
  );

  // Watch shadow-cljs config file for changes - restart Vite on config change
  let restartPromise: Promise<void> | null = null;
  const handleConfigChange = (file: string) => {
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
  };

  server.watcher.add(configPath);
  server.watcher.on("change", handleConfigChange);

  server.httpServer?.once("close", () => {
    server.watcher.off("change", handleConfigChange);
  });
}
