import { join, resolve } from "path";
import { chromium, type Browser, type Page } from "playwright-chromium";
import { createServer, type ViteDevServer } from "vite";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished,
} from "vitest";
import { collectBrowserLogs, editFile, untilBrowserLogAfter } from "./utils";

const FIXTURE_ROOT = resolve(__dirname, "./fixtures/hmr-project");
const HMR_TIMEOUT = 1000 * 60 * 3;

describe("E2E: Dev Server HMR", () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;
  let port: number;
  let browserLogs: string[];

  beforeAll(async () => {
    // Ensure shadow-cljs binary is on PATH
    const binPath = resolve(__dirname, "../../node_modules/.bin");
    const sep = process.platform === "win32" ? ";" : ":";
    process.env.PATH = `${binPath}${sep}${process.env.PATH}`;

    // Start Vite dev server (which spawns shadow-cljs watch)
    server = await createServer({
      root: FIXTURE_ROOT,
      configFile: join(FIXTURE_ROOT, "vite.config.ts"),
      logLevel: "warn",
      server: { port: 0 },
    });
    await server.listen();
    const addr = server.httpServer!.address();
    port = typeof addr === "object" ? addr!.port : 0;

    // Launch headless browser
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    browserLogs = collectBrowserLogs(page);

    // Wait for initial page load — shadow-cljs cold start can take
    // 60+ seconds on CI (JVM startup + first compilation)
    await page.goto(`http://localhost:${port}`, { timeout: 120000 });
    await page.waitForFunction(
      () => document.getElementById("app")?.textContent?.includes("Hello"),
      { timeout: 60000 },
    );
  }, HMR_TIMEOUT);

  afterAll(async () => {
    await page?.close();
    await browser?.close();
    await server?.close();
  }, 30000);

  it("should render initial content", async () => {
    expect(await page.textContent("#app")).toBe("Hello, World!");
  });

  it("should HMR without full page reload after editing CLJS", async () => {
    // Set a marker in the DOM — if page fully reloads, this disappears
    await page.evaluate(() => {
      (window as any).__hmr_marker = true;
    });

    // Clear logs before the edit
    browserLogs.length = 0;

    // Edit and wait for HMR log
    const logs = await untilBrowserLogAfter(
      page,
      async () => {
        const restore = await editFile(FIXTURE_ROOT, "src/my/app.cljs", (c) =>
          c.replace("Hello,", "Hey,"),
        );
        onTestFinished(restore);
      },
      ["[vite] hot updated:"],
    );

    // Verify DOM updated
    await expect
      .poll(() => page.textContent("#app"), { timeout: 10000 })
      .toBe("Hey, World!");

    // Verify it was HMR, not full reload
    const markerSurvived = await page.evaluate(
      () => (window as any).__hmr_marker,
    );
    expect(markerSurvived).toBe(true);

    // Verify HMR log includes the importer path
    expect(logs.some((l) => l.includes("[vite] hot updated:"))).toBe(true);
  });
}, HMR_TIMEOUT);
