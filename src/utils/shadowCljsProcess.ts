import { SpawnOptions, spawnSync, type ChildProcess } from "child_process";
import pc from "picocolors";
import { TAG } from "../constants";
import type { ShadowGlobalState } from "../types";
import { killIsolated, spawnIsolated } from "./processIsolation";

const SHADOW_GLOBAL_KEY = "__SHADOW_CLJS_VITE_PLUGIN_GLOBAL__";

export const getGlobalState = (): null | ShadowGlobalState => {
  if (!(globalThis as any)[SHADOW_GLOBAL_KEY]) return null;
  return (globalThis as any)[SHADOW_GLOBAL_KEY];
};

export const setGlobalShadowProcess = (
  proc: undefined | ChildProcess,
  projectRoot?: string
) => {
  const listeners = new Set<(buildId: string) => void>();
  (globalThis as any)[SHADOW_GLOBAL_KEY] = {
    process: proc,
    projectRoot,
    buildCompleteIds: new Set(),
    notifyBuildComplete(buildId: string) {
      listeners.forEach((listener) => listener(buildId));
    },
    onBuildComplete(listener: (buildId: string) => void): () => void {
      const _listener = listener.bind(null);
      listeners.add(_listener);
      return () => {
        listeners.delete(_listener);
      };
    },
  };
};

export const hasBuildCompleted = (buildId: string): boolean => {
  const state = getGlobalState();
  if (state == null) return false;
  return state.buildCompleteIds.has(buildId);
};

export async function waitForBuildComplete(buildId: string): Promise<void> {
  const state = getGlobalState();
  if (!state) {
    throw new Error("shadow-cljs process state not initialized");
  }

  if (state.buildCompleteIds.has(buildId)) return;

  await new Promise<void>((resolve) => {
    const stop = state.onBuildComplete((id) => {
      if (id !== buildId) return;
      stop();
      resolve();
    });
  });
}

const recordBuildCompleteFromLine = (line: string) => {
  const matched = line.match(/\[:([a-z0-9-_]+)\] build completed/i);

  if (!matched) return;

  const buildId = matched[1];

  const state = getGlobalState();
  if (state == null) {
    throw new Error("No global shadow-cljs state found");
  }

  if (!state.buildCompleteIds.has(buildId)) {
    state.buildCompleteIds.add(buildId);
    state.notifyBuildComplete(buildId);
  }
};
export function handleShadowProcessOutputs(proc: ChildProcess): void {
  proc.stdout?.on("data", (data: Buffer) => {
    // shadow-cljs log lines are prefixed; skip buffering to keep output streaming.
    for (const line of data.toString().trim().split("\n")) {
      console.log(`${TAG} ${line}`);

      if (line.length === 0) continue;
      recordBuildCompleteFromLine(line);
    }
  });

  proc.stderr?.on("data", (data: Buffer) => {
    // shadow-cljs log lines are prefixed; skip buffering to keep output streaming.
    for (const line of data.toString().trim().split("\n")) {
      console.error(`${TAG} ${pc.red(line)}`);

      if (line.length === 0) continue;
      recordBuildCompleteFromLine(line);
    }
  });

  proc.on("close", (code) => {
    if (code !== null && code !== 0) {
      console.error(
        `\n${pc.bgRed(pc.bold(" shadow-cljs crashed! "))} Exit code: ${code}\n`
      );
    }
  });
}

export async function stopGlobalShadowProcess() {
  const state = getGlobalState();
  if (state?.process) {
    console.log(`${TAG} Stopping shadow-cljs...`);

    await killShadowCljs(state.process, state.projectRoot);

    setGlobalShadowProcess(undefined);
  }
}

export function spawnShadowCljs(
  args: string[],
  options: { cwd: string; stdio: SpawnOptions["stdio"] }
): ChildProcess {
  return spawnIsolated("shadow-cljs", args, options);
}

export async function killShadowCljs(
  proc: ChildProcess,
  projectRoot?: string
): Promise<void> {
  // Step 1: Try graceful shutdown via shadow-cljs stop
  // This is the cleanest way as shadow-cljs knows how to stop its server
  // if (projectRoot) {
  //   const res = spawnSync("shadow-cljs", ["stop"], {
  //     cwd: projectRoot,
  //     stdio: "ignore",
  //     timeout: 2000,
  //   });

  //   if (res.status === 0) return;
  // }

  if (proc.pid == null || !(await killIsolated(proc))) {
    console.error("Terminating shadow-cljs process failed");
  }
}
