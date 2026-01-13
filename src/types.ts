import type { ChildProcess } from "child_process";

export interface ShadowCljsOptions {
  configPath?: string;
  buildIds: string[];
}

export interface BuildConfig {
  id: string;
  outputDir: string;
  modules: string[];
  runtime?: string;
}

export interface PluginContext {
  projectRoot: string;
  configPath: string;
  buildConfigs: Map<string, BuildConfig>;
}

export interface ShadowGlobalState {
  process: ChildProcess | undefined;
  projectRoot: string | undefined;
  buildCompleteIds: Set<string>;
  notifyBuildComplete(buildId: string): void;
  onBuildComplete(listener: (buildId: string) => void): () => void;
}
