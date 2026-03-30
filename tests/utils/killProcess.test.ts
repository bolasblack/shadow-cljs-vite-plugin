import { describe, it, expect, afterEach } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import { killProcess } from "../../src/utils/killProcess";

function spawnDetachedChild(
  grandchildScript: string
): Promise<ChildProcess> {
  const child = spawn(
    "node",
    [
      "-e",
      `
      const { spawn } = require("child_process");
      const gc = spawn("node", ["-e", ${JSON.stringify(grandchildScript)}], {
        stdio: "inherit",
      });
      gc.on("exit", (c) => process.exit(c || 0));
      `,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    }
  );

  return new Promise((resolve, reject) => {
    child.once("spawn", () => resolve(child));
    child.once("error", reject);
  });
}

describe("killProcess", () => {
  const spawnedPids: number[] = [];

  afterEach(() => {
    for (const pid of spawnedPids) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {}
    }
    spawnedPids.length = 0;
  });

  describe("graceful mode (default)", () => {
    it("should send SIGINT first, then SIGKILL after child exits", async () => {
      const proc = await spawnDetachedChild(
        "setInterval(() => {}, 1000);"
      );
      spawnedPids.push(proc.pid!);

      const pid = proc.pid!;
      const killCalls: Array<[number, number | string | undefined]> = [];
      const originalKill = process.kill.bind(process);
      process.kill = ((p: number, s?: number | NodeJS.Signals) => {
        killCalls.push([p, s]);
        return originalKill(p, s);
      }) as typeof process.kill;

      try {
        await killProcess(proc);
      } finally {
        process.kill = originalKill;
      }

      const sigintToGroup = killCalls.filter(
        ([p, sig]) => p === -pid && sig === "SIGINT"
      );
      const sigkillToGroup = killCalls.filter(
        ([p, sig]) => p === -pid && sig === "SIGKILL"
      );

      expect(sigintToGroup.length).toBeGreaterThan(0);
      expect(sigkillToGroup.length).toBeGreaterThan(0);
    });

    it("should wait for child to exit before sending SIGKILL", async () => {
      const proc = await spawnDetachedChild(
        "setInterval(() => {}, 1000);"
      );
      spawnedPids.push(proc.pid!);

      const pid = proc.pid!;
      let sigintTime = 0;
      let sigkillTime = 0;
      const originalKill = process.kill.bind(process);
      process.kill = ((p: number, s?: number | NodeJS.Signals) => {
        if (p === -pid && s === "SIGINT" && !sigintTime)
          sigintTime = Date.now();
        if (p === -pid && s === "SIGKILL" && !sigkillTime)
          sigkillTime = Date.now();
        return originalKill(p, s);
      }) as typeof process.kill;

      try {
        await killProcess(proc);
      } finally {
        process.kill = originalKill;
      }

      expect(sigintTime).toBeGreaterThan(0);
      expect(sigkillTime).toBeGreaterThan(0);
      // SIGKILL should come AFTER waiting for child (at least one poll cycle)
      expect(sigkillTime - sigintTime).toBeGreaterThanOrEqual(50);
    });

    it("should kill grandchild that handles SIGINT", async () => {
      const fs = await import("fs");
      const marker = "/tmp/test-killprocess-graceful-" + process.pid;

      const proc = await spawnDetachedChild(`
        process.on('SIGINT', () => {
          setTimeout(() => process.exit(0), 30000);
        });
        const fs = require('fs');
        setInterval(() => {
          try { fs.writeFileSync(${JSON.stringify(marker)}, '' + Date.now()); } catch {}
        }, 50);
      `);
      spawnedPids.push(proc.pid!);

      await new Promise((r) => setTimeout(r, 300));
      expect(fs.existsSync(marker)).toBe(true);

      await killProcess(proc);
      await new Promise((r) => setTimeout(r, 300));

      const mtimeBefore = fs.statSync(marker).mtimeMs;
      await new Promise((r) => setTimeout(r, 200));
      let mtimeAfter: number;
      try {
        mtimeAfter = fs.statSync(marker).mtimeMs;
      } catch {
        mtimeAfter = mtimeBefore;
      }
      expect(mtimeAfter).toBe(mtimeBefore);

      try {
        fs.unlinkSync(marker);
      } catch {}
    });

    it("should use child liveness check (not group) to avoid zombie hang", async () => {
      const proc = await spawnDetachedChild(
        "setInterval(() => {}, 1000);"
      );
      spawnedPids.push(proc.pid!);

      const pid = proc.pid!;
      const killCalls: Array<[number, number | string | undefined]> = [];
      const originalKill = process.kill.bind(process);
      process.kill = ((p: number, s?: number | NodeJS.Signals) => {
        killCalls.push([p, s]);
        return originalKill(p, s);
      }) as typeof process.kill;

      try {
        await killProcess(proc);
      } finally {
        process.kill = originalKill;
      }

      const livenessChecks = killCalls.filter(
        ([, sig]) => sig === 0 || sig === undefined
      );
      const groupChecks = livenessChecks.filter(([p]) => p < 0);
      const childChecks = livenessChecks.filter(([p]) => p > 0);

      expect(groupChecks).toHaveLength(0);
      expect(childChecks.length).toBeGreaterThan(0);
    });
  });

  describe("force mode", () => {
    it("should send SIGKILL synchronously with no preceding await", async () => {
      const proc = await spawnDetachedChild(
        "setInterval(() => {}, 1000);"
      );
      spawnedPids.push(proc.pid!);

      const pid = proc.pid!;
      const startTime = Date.now();
      let sigkillTime = 0;
      const originalKill = process.kill.bind(process);
      const patchedKill = (p: number, s?: number | NodeJS.Signals) => {
        if (p === -pid && s === "SIGKILL") sigkillTime = Date.now();
        return originalKill(p, s);
      };
      process.kill = patchedKill as typeof process.kill;

      try {
        await killProcess(proc, { force: true });
      } finally {
        process.kill = originalKill;
      }

      expect(sigkillTime).toBeGreaterThan(0);
      expect(sigkillTime - startTime).toBeLessThan(5);
    });

    it("should not send SIGINT", async () => {
      const proc = await spawnDetachedChild(
        "setInterval(() => {}, 1000);"
      );
      spawnedPids.push(proc.pid!);

      const pid = proc.pid!;
      const killCalls: Array<[number, number | string | undefined]> = [];
      const originalKill = process.kill.bind(process);
      process.kill = ((p: number, s?: number | NodeJS.Signals) => {
        killCalls.push([p, s]);
        return originalKill(p, s);
      }) as typeof process.kill;

      try {
        await killProcess(proc, { force: true });
      } finally {
        process.kill = originalKill;
      }

      const sigintCalls = killCalls.filter(
        ([p, sig]) => p === -pid && sig === "SIGINT"
      );
      expect(sigintCalls).toHaveLength(0);
    });

    it("should complete nearly instantly", async () => {
      const proc = await spawnDetachedChild(
        "setInterval(() => {}, 1000);"
      );
      spawnedPids.push(proc.pid!);

      const start = Date.now();
      await killProcess(proc, { force: true });
      expect(Date.now() - start).toBeLessThan(100);
    });
  });
});
