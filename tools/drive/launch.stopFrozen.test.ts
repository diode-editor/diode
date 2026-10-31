import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { stopSession } from "./launch.ts";
import { isAlive } from "./processes.ts";
import { SessionRegistry } from "./sessionRegistry.ts";

const STOP_LIMIT_MS = 30_000;

const children: ChildProcess[] = [];
const dirs: string[] = [];
afterEach(() => {
    for (const child of children.splice(0)) child.kill("SIGKILL");
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A listening process, like an editor with its inspector port; the kernel keeps accepting connections once it is frozen. */
async function spawnListener(): Promise<{ child: ChildProcess; port: number }> {
    const script =
        "require('net').createServer().listen(0,'127.0.0.1',function(){process.stdout.write(String(this.address().port))})";
    const child = spawn(process.execPath, ["-e", script], {
        stdio: ["ignore", "pipe", "ignore"],
        detached: true,
    });
    children.push(child);
    const port = await new Promise<number>((resolve) =>
        child.stdout.once("data", (data: Buffer) => {
            resolve(Number(data.toString()));
        }),
    );
    return { child, port };
}

describe("stopSession", () => {
    it(
        "finishes off a frozen session within its limit, so the next session can start",
        async () => {
            const root = mkdtempSync(join(tmpdir(), "drive-stop-frozen-"));
            dirs.push(root);
            mkdirSync(join(root, "drive"));
            const { child, port } = await spawnListener();
            const pid = child.pid ?? 0;
            const registry = new SessionRegistry(join(root, "registry"));
            const record = {
                name: "frozen",
                pid,
                windowPid: pid,
                port,
                root,
                workspaceDir: root,
                userDataDir: root,
                mode: "source",
                entry: "",
                cols: 80,
                rows: 24,
                startedAt: new Date().toISOString(),
                stdoutFile: join(root, "stdout"),
                stderrFile: join(root, "stderr"),
                marker: `frozen:${root}`,
                keep: true,
            } as const;
            registry.write(record);
            process.kill(pid, "SIGSTOP");

            const outcome = await Promise.race([
                stopSession(registry, record, { keep: true }).then(() => "stopped"),
                new Promise<string>((resolve) => {
                    setTimeout(() => {
                        resolve("stop hung");
                    }, STOP_LIMIT_MS);
                }),
            ]);

            expect(outcome).toBe("stopped");
            expect(isAlive(pid)).toBe(false);
        },
        STOP_LIMIT_MS + 5_000,
    );
});
