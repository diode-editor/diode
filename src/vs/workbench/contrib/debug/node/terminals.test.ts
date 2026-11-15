import { type ChildProcess, spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { hasChildProcesses } from "./terminals.ts";

const children: ChildProcess[] = [];
const dirs: string[] = [];

afterEach(() => {
    // Detached: the group goes with its children (the `sleep` would outlive its shell).
    for (const child of children.splice(0)) process.kill(-(child.pid ?? 0), "SIGKILL");
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A `pgrep` that runs `script`. */
function fakePgrep(script: string): string {
    const dir = mkdtempSync(join(tmpdir(), "diode-pgrep-"));
    dirs.push(dir);
    const path = join(dir, "pgrep");
    writeFileSync(path, `#!/bin/sh\n${script}\n`);
    chmodSync(path, 0o755);
    return path;
}

describe("hasChildProcesses", () => {
    describe.skipIf(process.platform === "win32")("pgrep", () => {
        it("a shell running a program is busy, an idle one is not", async () => {
            const busy = spawn("/bin/sh", ["-c", "sleep 30; true"], { stdio: "ignore", detached: true });
            const idle = spawn("/bin/sh", ["-c", "read x"], { stdio: ["pipe", "ignore", "ignore"], detached: true });
            children.push(busy, idle);
            await expect.poll(() => hasChildProcesses(busy.pid)).toBe(true);
            await expect(hasChildProcesses(idle.pid)).resolves.toBe(false);
        });

        it("asks pgrep for the children of the process", async () => {
            const path = fakePgrep(`[ "$1 $2" = "-lP 4242" ] && echo '7 sleep'`);
            await expect(hasChildProcesses(4242, path)).resolves.toBe(true);
            await expect(hasChildProcesses(4243, path)).resolves.toBe(false);
        });

        it("a tmux child doesn't make the shell busy; blanks are no children", async () => {
            await expect(hasChildProcesses(1, fakePgrep("printf '%s' '12 tmux'"))).resolves.toBe(false);
            await expect(hasChildProcesses(1, fakePgrep("printf '%s' '  \n'"))).resolves.toBe(false);
            await expect(hasChildProcesses(1, fakePgrep("printf '%s' '12 vim'"))).resolves.toBe(true);
        });

        it("without a process id, or on Windows, the shell counts as busy without asking", async () => {
            const idle = fakePgrep("true");
            await expect(hasChildProcesses(1, idle)).resolves.toBe(false);
            await expect(hasChildProcesses(undefined, idle)).resolves.toBe(true);
            await expect(hasChildProcesses(0, idle)).resolves.toBe(true);
            const platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
            try {
                await expect(hasChildProcesses(1, idle)).resolves.toBe(true);
            } finally {
                platform.mockRestore();
            }
        });

        it("no pgrep: busy", async () => {
            await expect(hasChildProcesses(1, "/nonexistent/pgrep")).resolves.toBe(true);
        });
    });
});
