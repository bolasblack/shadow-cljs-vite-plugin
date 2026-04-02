import * as fs from "fs/promises";
import { resolve } from "path";
import type { Page } from "playwright-chromium";

/**
 * Edit a file and return a restore function.
 * Use with `onTestFinished(restore)` to auto-restore.
 */
export async function editFile(
  fixtureRoot: string,
  relativePath: string,
  transform: (content: string) => string,
): Promise<() => Promise<void>> {
  const filePath = resolve(fixtureRoot, relativePath);
  const original = await fs.readFile(filePath, "utf-8");
  await fs.writeFile(filePath, transform(original));
  return () => fs.writeFile(filePath, original);
}

/**
 * Collect browser console logs into an array.
 * Returns the array reference (mutated in-place as logs arrive).
 */
export function collectBrowserLogs(page: Page): string[] {
  const logs: string[] = [];
  page.on("console", (msg) => logs.push(msg.text()));
  return logs;
}

/**
 * Perform an action and wait until specific browser log messages appear.
 * Useful for verifying HMR message sequences.
 *
 * @param page - Playwright page
 * @param action - async function that triggers the logs (e.g., editFile)
 * @param targets - log substrings to wait for (all must appear)
 * @param timeout - max wait time in ms
 */
export async function untilBrowserLogAfter(
  page: Page,
  action: () => Promise<unknown>,
  targets: string[],
  timeout = 30000,
): Promise<string[]> {
  const logs: string[] = [];
  const remaining = new Set(targets);

  const promise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `Timeout waiting for browser logs. Missing: ${[...remaining].join(", ")}`,
          ),
        ),
      timeout,
    );

    const handler = (msg: { text(): string }) => {
      const text = msg.text();
      logs.push(text);
      for (const target of remaining) {
        if (text.includes(target)) {
          remaining.delete(target);
        }
      }
      if (remaining.size === 0) {
        clearTimeout(timer);
        page.off("console", handler);
        resolve();
      }
    };

    page.on("console", handler);
  });

  await action();
  await promise;
  return logs;
}
