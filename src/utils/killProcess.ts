import type { ChildProcess } from "child_process";
import os from "os";
import { spawnAsync } from "./spawnAsync";

// AGD-002: Kill the entire process group (negative pid) to ensure
// shadow-cljs and all its JVM children are terminated together.
export async function killProcess(proc: ChildProcess) {
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
    const doKill = (signal: number | NodeJS.Signals): boolean => {
      try {
        process.kill(-pid, signal);
        return false;
      } catch (e: any) {
        if (e.code === "ESRCH") return true;
        throw e;
      }
    };

    doKill("SIGINT");
    while (/* check if process is still alive */ !doKill(0)) {
      await new Promise((r) => setTimeout(r, 100));
      if (doKill("SIGKILL")) break;
    }
  }
}
