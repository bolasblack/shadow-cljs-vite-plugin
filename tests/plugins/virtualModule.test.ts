import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "path";
import {
  createVirtualModulePlugin,
  generateGlobalNamespaceModule,
} from "../../src/plugins/virtualModule";
import type { PluginContext, ShadowCljsOptions } from "../../src/types";
import type { ViteDevServer, Plugin } from "vite";

/**
 * Helper to extract the plugin object from createVirtualModulePlugin.
 */
function createPlugin(overrides?: {
  globalState?: any;
  buildConfigs?: Map<string, any>;
}) {
  const ctx: Partial<PluginContext> = {
    projectRoot: "/test/project",
    configPath: "/test/project/shadow-cljs.edn",
    buildConfigs:
      overrides?.buildConfigs ??
      new Map([
        [
          "app",
          {
            id: "app",
            target: "esm",
            outputDir: ".shadow-cljs-out/app",
            modules: ["main"],
          },
        ],
      ]),
  };

  if (overrides?.globalState !== undefined) {
    (globalThis as any).__SHADOW_CLJS_VITE_PLUGIN_GLOBAL__ =
      overrides.globalState;
  }

  const initContext = vi.fn();
  const getContext = () => ctx as PluginContext;
  const options: ShadowCljsOptions = { buildIds: ["app"] };

  const plugin = createVirtualModulePlugin(
    initContext,
    getContext,
    options,
  ) as Plugin;
  return { plugin, ctx, getContext };
}

const SAMPLE_CLJS_OUTPUT = `import "./cljs_env.js";
import "./cljs/core.js";
import "./app/core.js";
export let greet = app.core.greet;
export let add = app.core.add;
`;

describe("virtualModule plugin", () => {
  beforeEach(() => {
    delete (globalThis as any).__SHADOW_CLJS_VITE_PLUGIN_GLOBAL__;
  });

  describe("configResolved() — watch ignore from build configs", () => {
    it("should add ignore patterns for actual output directories", async () => {
      const buildConfigs = new Map([
        ["app", { id: "app", target: "esm", outputDir: "build/js/app", modules: ["main"] }],
        ["worker", { id: "worker", target: "esm", outputDir: "out/worker", modules: ["main"] }],
      ]);
      const { plugin } = createPlugin({ buildConfigs });

      // Simulate a resolved config with existing ignored patterns
      const resolvedConfig = {
        root: "/test/project",
        command: "serve",
        server: { watch: { ignored: ["**/node_modules/**"] as any[] } },
      };

      await (plugin.configResolved as Function)(resolvedConfig);

      const ignored = resolvedConfig.server.watch.ignored;
      // Original pattern + 2 new ones (one per output directory)
      expect(ignored).toHaveLength(3);

      // New patterns are functions that match output dirs
      const appMatcher = ignored[1] as (p: string) => boolean;
      const workerMatcher = ignored[2] as (p: string) => boolean;

      expect(appMatcher("/test/project/build/js/app/main.js")).toBe(true);
      expect(appMatcher("/test/project/build/js/other.js")).toBe(false);
      expect(workerMatcher("/test/project/out/worker/main.js")).toBe(true);
      expect(workerMatcher("/test/project/src/app.tsx")).toBe(false);
    });

    it("should not modify config for build command", async () => {
      const { plugin } = createPlugin();
      const resolvedConfig = {
        root: "/test/project",
        command: "build",
        server: { watch: { ignored: ["**/node_modules/**"] } },
      };
      await (plugin.configResolved as Function)(resolvedConfig);
      expect(resolvedConfig.server.watch.ignored).toHaveLength(1);
    });
  });

  describe("hotUpdate() — browser target interception", () => {
    it("should return empty array for files in browser target output dir", () => {
      const { plugin } = createPlugin();
      const hmrCtx = {
        file: resolve("/test/project", ".shadow-cljs-out/app/main.js"),
        modules: [],
        timestamp: Date.now(),
        read: vi.fn(),
        server: {} as any,
      };
      const result = (plugin.hotUpdate as Function).call(plugin, hmrCtx);
      expect(result).toEqual([]);
    });
  });

  describe("configureServer() — build-complete + eval-complete round-trip", () => {
    function setupServer() {
      const buildCompleteListeners: ((buildId: string) => void)[] = [];
      const globalState = {
        process: {},
        buildCompleteIds: new Set<string>(),
        onBuildComplete(listener: (buildId: string) => void) {
          buildCompleteListeners.push(listener);
          return () => {};
        },
        notifyBuildComplete(buildId: string) {
          buildCompleteListeners.forEach((l) => l(buildId));
        },
      };

      const { plugin } = createPlugin({ globalState });

      const hotSend = vi.fn();
      const hotOnHandlers = new Map<string, Function>();
      const hotOn = vi.fn((event: string, handler: Function) => {
        hotOnHandlers.set(event, handler);
      });
      const mockServer = {
        environments: {
          client: {
            moduleGraph: {
              getModuleById: vi.fn().mockReturnValue({
                url: "/@id/__x00__virtual:shadow-cljs/app",
                importers: new Set([{ url: "/src/tsx/App.tsx" }]),
              }),
            },
            hot: { send: hotSend, on: hotOn },
          },
        },
        watcher: { on: vi.fn() },
        httpServer: { once: vi.fn() },
      } as unknown as ViteDevServer;

      (plugin.configureServer as Function)(mockServer);

      return { globalState, hotSend, hotOn, hotOnHandlers };
    }

    it("should send build-complete custom event after initial build skipped", () => {
      const { globalState, hotSend } = setupServer();

      // Initial build — skipped
      globalState.notifyBuildComplete("app");
      expect(hotSend).not.toHaveBeenCalled();

      // Subsequent build — sends build-complete custom event
      globalState.notifyBuildComplete("app");

      const customCalls = hotSend.mock.calls.filter(
        (args: any[]) => args[0] === "shadow-cljs:build-complete",
      );
      expect(customCalls).toHaveLength(1);
    });

    it("should register eval-complete listener that sends js-update", () => {
      const { hotSend, hotOnHandlers } = setupServer();

      // Must have eval-complete listener
      expect(hotOnHandlers.has("shadow-cljs:eval-complete")).toBe(true);

      // Simulate client sending eval-complete
      hotOnHandlers.get("shadow-cljs:eval-complete")!({});

      // Should send js-update for importers only (client already
      // refreshed virtual module's let-bindings via live exports)
      const updateCalls = hotSend.mock.calls.filter(
        (args: any[]) =>
          typeof args[0] === "object" && args[0]?.type === "update",
      );
      expect(updateCalls).toHaveLength(1);

      const updates = updateCalls[0][0].updates;
      expect(updates).toHaveLength(1);
      expect(updates[0].path).toBe("/src/tsx/App.tsx");
    });

    it("should skip non-matching build IDs", () => {
      const { globalState, hotSend } = setupServer();
      globalState.notifyBuildComplete("app"); // skip initial
      globalState.notifyBuildComplete("other-build");
      expect(hotSend).not.toHaveBeenCalled();
    });
  });

  describe("generated module code — poll-based HMR", () => {
    it("should poll globals for changes after build-complete event", () => {
      const result = generateGlobalNamespaceModule(
        SAMPLE_CLJS_OUTPUT,
        "/test/project/.shadow-cljs-out/app/main.js",
        false,
      );

      // Should listen for build-complete custom event
      expect(result).toContain("shadow-cljs:build-complete");

      // Should send eval-complete back to server
      expect(result).toContain("shadow-cljs:eval-complete");
      expect(result).toContain("import.meta.hot.send");

      // Should self-accept
      expect(result).toContain("import.meta.hot.accept()");

      // Should NOT monkey-patch SHADOW_ENV
      expect(result).not.toContain("setLoaded");

      // Should NOT use invalidate
      expect(result).not.toMatch(/import\.meta\.hot\.invalidate/);

      // Should NOT use fixed delay on client
      // (server may use setTimeout but client should poll deterministically)

      // Should export from global namespace
      expect(result).toContain("let greet = app.core.greet;");
      expect(result).toContain("export { greet, add }");

      // Should refresh let-bindings inside the poll handler
      // (before sending eval-complete, so importers see fresh values)
      const pollBlock = result.match(
        /shadow-cljs:build-complete[\s\S]*?shadow-cljs:eval-complete/,
      );
      expect(pollBlock).not.toBeNull();
      expect(pollBlock![0]).toContain("greet = app.core.greet;");
      expect(pollBlock![0]).toContain("add = app.core.add;");
    });
  });
});
