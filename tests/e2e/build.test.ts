import * as fs from "fs/promises";
import { join, resolve } from "path";
import { createBuilder } from "vite";
import { beforeAll, describe, expect, it } from "vitest";
import { existsAsync } from "../../src/utils/existsAsync";

const FIXTURE_ROOT = resolve(__dirname, "./fixtures/simple-project");
const SHADOW_OUT_DIR = join(FIXTURE_ROOT, ".shadow-cljs-out");
const BUILD_OUT_DIR = join(FIXTURE_ROOT, "dist");
const BUILD_TIMEOUT = 1000 * 60 * 5;

describe("E2E: Real Build with Cloudflare", () => {
  let allDistFiles: string[] = [];

  beforeAll(async () => {
    // Ensure shadow-cljs binary is on PATH
    const binPath = resolve(__dirname, "../../node_modules/.bin");
    const sep = process.platform === "win32" ? ";" : ":";
    process.env.PATH = `${binPath}${sep}${process.env.PATH}`;

    await fs.rm(BUILD_OUT_DIR, { recursive: true, force: true });
    await fs.rm(SHADOW_OUT_DIR, { recursive: true, force: true });

    const builder = await createBuilder({
      root: FIXTURE_ROOT,
      configFile: join(FIXTURE_ROOT, "vite.config.ts"),
      logLevel: "info",
    });
    await builder.buildApp();

    allDistFiles = await fs.readdir(BUILD_OUT_DIR, { recursive: true });
  }, BUILD_TIMEOUT);

  it("should generate shadow-cljs intermediate artifacts", async () => {
    for (const path of [
      join(SHADOW_OUT_DIR, "browser/main.js"),
      join(SHADOW_OUT_DIR, "worker/main.js"),
    ]) {
      expect(await existsAsync(path)).toBe(true);
    }
  });

  it("should successfully execute the Worker bundle", async () => {
    const workerFile = allDistFiles.find(
      (f) => f.includes("ssr/") && f.endsWith(".js"),
    );
    if (!workerFile) throw new Error("Worker bundle not found in dist");

    // Dynamic import directly — no temp file needed
    const mod = await import(join(BUILD_OUT_DIR, workerFile));
    const handler = mod.default ?? mod;
    expect(typeof handler.fetch).toBe("function");

    const response = await handler.fetch({}, {}, {});
    const text = await response.text();
    expect(text).toMatch(/Hello .* from node/);
  });

  it("should successfully execute the Browser bundle", async () => {
    const indexHtml = allDistFiles.find((f) => f.endsWith("index.html"));
    if (!indexHtml) throw new Error("index.html not found in dist");

    const html = await fs.readFile(join(BUILD_OUT_DIR, indexHtml), "utf-8");
    const match = html.match(/src="\/assets\/(.*?\.js)"/);
    if (!match) throw new Error("No script src found in index.html");

    const jsPath = join(BUILD_OUT_DIR, indexHtml, "..", "assets", match[1]);

    // Use JSDOM to provide browser globals for the CLJS bundle
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
      url: "http://localhost/",
      runScripts: "dangerously",
      resources: "usable",
    });

    const output: string[] = [];
    dom.window.document.write = ((text: string) =>
      output.push(text)) as typeof dom.window.document.write;

    // CLJS bundles expect these globals
    const globals = [
      "window",
      "document",
      "MutationObserver",
      "Node",
      "Element",
      "Event",
      "CustomEvent",
    ] as const;
    const saved: Record<string, unknown> = {};
    for (const key of globals) {
      saved[key] = (globalThis as any)[key];
      (globalThis as any)[key] = dom.window[key];
    }

    try {
      await import(jsPath);
      expect(output.join("")).toContain("Hello world from browser");
    } finally {
      for (const key of globals) {
        if (saved[key] === undefined) delete (globalThis as any)[key];
        else (globalThis as any)[key] = saved[key];
      }
    }
  });
});
