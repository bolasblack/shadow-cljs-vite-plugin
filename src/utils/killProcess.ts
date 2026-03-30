import type { ChildProcess } from "child_process";
import os from "os";
import { spawnAsync } from "./spawnAsync";

export interface KillProcessOptions {
  /**
   * When false (the default), send SIGINT first and wait for the
   * direct child to exit (up to `gracefulTimeout` ms) before
   * escalating to SIGKILL.
   *
   * When true, send SIGKILL immediately with no async operations.
   * Use this in signal handlers where the Vite process may be
   * terminated at any `await` point (e.g. pnpm sends SIGTERM).
   */
  force?: boolean;

  /** Milliseconds to wait for graceful shutdown before SIGKILL.  Default: 2000. */
  gracefulTimeout?: number;
}

// AGD-002: Kill the entire process group (negative pid) to ensure
// shadow-cljs and all its JVM children are terminated together.
export async function killProcess(
  proc: ChildProcess,
  opts?: KillProcessOptions
) {
  const { force = false, gracefulTimeout = 2000 } = opts ?? {};

  if (os.platform() === "win32") {
    await spawnAsync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else if (proc.pid == null) {
    try {
      proc.kill("SIGKILL");
    } catch (e: any) {
      if (e.code !== "ESRCH") throw e;
    }
  } else {
    const pid = proc.pid;

    /** Send a signal. Returns true if delivered, false if ESRCH. */
    const tryKill = (
      target: number,
      signal: NodeJS.Signals | 0
    ): boolean => {
      try {
        process.kill(target, signal);
        return true;
      } catch (e: any) {
        if (e.code === "ESRCH") return false;
        throw e;
      }
    };

    if (force) {
      // Force mode: SIGKILL immediately, no async yield.
      // Safe in signal handlers where pnpm may kill us at any await.
      tryKill(-pid, "SIGKILL");
    } else {
      // Graceful mode: SIGINT first, wait for child to exit, then SIGKILL.
      // Checks direct child PID (not group) for liveness — libuv
      // reaps it promptly via SIGCHLD, avoiding zombie hangs.
      tryKill(-pid, "SIGINT");

      const deadline = Date.now() + gracefulTimeout;
      while (tryKill(pid, 0) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }

      // Unconditionally SIGKILL the group to ensure any grandchildren
      // (e.g. JVM doing slow shutdown hooks) are terminated.
      tryKill(-pid, "SIGKILL");
    }
  }
}
