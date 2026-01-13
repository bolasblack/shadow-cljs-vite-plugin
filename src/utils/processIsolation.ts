/**
 * Cross-platform process isolation utilities.
 *
 * Provides reliable process spawning and killing, ensuring all descendant
 * processes are terminated when the parent is killed.
 *
 * ## The Problem
 *
 * Some programs (e.g., shadow-cljs, gradle) spawn child processes with
 * `detached: true`, creating separate process groups. This makes them
 * impossible to kill with a simple `kill(-pgid)`.
 *
 * On systemd-based Linux (CachyOS, Arch, Ubuntu), orphaned processes are
 * quickly re-parented to PID 1, making PPID-based tree traversal unreliable.
 *
 * ## Solutions
 *
 * ### 1. PID Namespace (Linux)
 * Uses `unshare --pid --fork --kill-child` to run the command in an isolated
 * PID namespace. When unshare exits, the kernel sends SIGKILL to ALL processes
 * in that namespace - a kernel-level guarantee that no descendant can escape.
 *
 * Requirements:
 * - Linux kernel with PID namespace support (most modern kernels)
 * - `unshare` from util-linux >= 2.25 (for --kill-child)
 * - Root privileges OR unprivileged user namespaces enabled
 *   (sysctl kernel.unprivileged_userns_clone=1, default on most distros)
 *
 * ### 2. Process Group Kill (Fallback)
 * Traditional `kill(-pgid)` / `taskkill /T` approach. Works when the spawned
 * program doesn't create detached children, or on non-Linux platforms.
 */

import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
} from "child_process";
import os from "os";

/**
 * Cached result of PID namespace availability check.
 * null = not yet checked, true/false = cached result
 */
let pidNamespaceSupported: boolean | null = null;

/**
 * Check if PID namespace with --kill-child is supported on this system.
 *
 * Tests by actually running unshare with the required flags. This is more
 * reliable than checking util-linux version, as some systems may have
 * unshare but with restricted capabilities.
 */
function checkPidNamespaceSupport(): boolean {
  if (pidNamespaceSupported !== null) {
    return pidNamespaceSupported;
  }

  if (os.platform() !== "linux") {
    pidNamespaceSupported = false;
    return false;
  }

  try {
    // Try to create a PID namespace and immediately exit
    // --pid: create new PID namespace
    // --fork: fork before exec (required for PID namespace)
    // --kill-child: send SIGKILL to children when unshare exits
    // We run 'true' as a no-op command to test if it works
    const result = spawnSync(
      "unshare",
      ["--pid", "--fork", "--kill-child", "true"],
      {
        stdio: "ignore",
        timeout: 5000,
      }
    );

    // Exit code 0 means it worked
    pidNamespaceSupported = result.status === 0;
  } catch {
    pidNamespaceSupported = false;
  }

  return pidNamespaceSupported;
}

/**
 * Spawns <command> with appropriate process isolation.
 *
 * On Linux with PID namespace support:
 *   Uses `unshare --pid --fork --kill-child <command> ...`
 *   This ensures ALL descendant processes are killed when we kill unshare.
 *
 * On other platforms or when PID namespace is unavailable:
 *   Uses standard `detached: true` to create a new process group,
 *   allowing us to kill the group with `kill(-pgid)`.
 */
export function spawnIsolated(
  command: string,
  args: string[],
  options: { cwd: string; stdio: SpawnOptions["stdio"] }
): ChildProcess {
  const usePidNamespace = checkPidNamespaceSupport();

  if (usePidNamespace) {
    // Wrap command in a PID namespace
    // When unshare is killed, kernel SIGKILLs all processes in the namespace
    return spawn(
      "unshare",
      [
        "--pid", // Create new PID namespace
        "--fork", // Fork before exec (required for --pid)
        "--kill-child", // Kill all children when unshare exits
        command,
        ...args,
      ],
      {
        stdio: options.stdio,
        cwd: options.cwd,
        // Still use detached so we can kill the process group if needed
        detached: true,
      }
    );
  }

  // Fallback: standard detached spawn
  // On Windows, don't use detached (different semantics)
  // On Unix without PID namespace, use detached for process group control
  return spawn(command, args, {
    stdio: options.stdio,
    cwd: options.cwd,
    detached: os.platform() !== "win32",
  });
}

/**
 * Kills the process and all its descendants.
 *
 * Strategy:
 * 1. Kill the process/process group
 *    - If using PID namespace: just kill unshare, kernel handles the rest
 *    - Otherwise: kill(-pgid) to kill process group
 * 2. Wait briefly, then SIGKILL for any survivors
 */
export async function killIsolated(proc: ChildProcess): Promise<boolean> {
  if (proc.pid == null) {
    throw new Error("[killIsolated] process pid is null");
  }

  const pid = proc.pid;

  /**
   * Attempts to kill the process (group).
   *
   * On Windows: uses taskkill /T to kill the process tree
   * On Unix: uses kill(-pid) to send signal to entire process group
   *
   * If using PID namespace, killing the unshare process triggers the
   * kernel to SIGKILL all processes in the namespace automatically.
   */
  const tryKill = (signal: NodeJS.Signals): boolean => {
    try {
      if (os.platform() === "win32") {
        // Windows: taskkill /T kills the process tree
        spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
          stdio: "ignore",
        });
      } else {
        // Unix: negative PID means "process group"
        // This kills all processes in the group with the given signal
        //
        // When PID namespace is used:
        // - Killing unshare (the process group leader) is enough
        // - The --kill-child flag ensures kernel sends SIGKILL to all
        //   processes in the namespace when unshare dies
        process.kill(-pid, signal);
      }
      return true;
    } catch (e: any) {
      // ESRCH: No such process - already dead, that's fine
      if (e.code === "ESRCH") return true;

      // EPERM: Permission denied to kill process group
      // Fall back to killing just the direct child process
      if (e.code === "EPERM") {
        try {
          proc.kill(signal);
        } catch (e: any) {
          if (e.code === "ESRCH") return true;
        }
      }
      return false;
    }
  };

  // Step 2: Send SIGTERM for graceful shutdown
  if (tryKill("SIGTERM")) return true;

  // Step 3: Wait a bit for processes to exit gracefully
  await new Promise((r) => setTimeout(r, 1000));

  // Step 4: Force kill any survivors
  if (tryKill("SIGKILL")) return true;

  return false;
}
