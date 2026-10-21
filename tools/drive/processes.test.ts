import { type ChildProcess, spawn } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { findMarkedProcesses, isAlive, killSessionProcesses } from "./processes.ts";
import { SESSION_MARKER_ENV } from "./sessionRegistry.ts";

const children: ChildProcess[] = [];
afterEach(() => {
    for (const c of children.splice(0)) c.kill("SIGKILL");
});

async function spawnMarked(
    marker: string,
    opts: { detached?: boolean; ignoreTerm?: boolean } = {},
): Promise<ChildProcess> {
    const ignore = opts.ignoreTerm === true ? "process.on('SIGTERM',()=>{});" : "";
    const child = spawn(process.execPath, ["-e", `${ignore}process.stdout.write('ready');setInterval(()=>{},1000)`], {
        env: { ...process.env, [SESSION_MARKER_ENV]: marker },
        stdio: ["ignore", "pipe", "ignore"],
        detached: opts.detached ?? false,
    });
    children.push(child);
    // A signal before the handler is installed would kill the "deaf" child too early.
    await new Promise<void>((resolve) =>
        child.stdout.once("data", () => {
            resolve();
        }),
    );
    return child;
}

async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error("timeout");
        await new Promise((r) => setTimeout(r, 20));
    }
}

describe("isAlive", () => {
    it("own process is alive, a nonexistent pid is not", () => {
        expect(isAlive(process.pid)).toBe(true);
        expect(isAlive(2 ** 22 + 12345)).toBe(false);
    });
});

describe.skipIf(process.platform !== "linux")("isAlive — zombie", () => {
    it("unreaped child after SIGKILL is dead, although kill(pid, 0) sees it", async () => {
        // A child with `ignore` stdio and no exit listener: libuv does not reap it right away,
        // so catch the window while it is a zombie via /proc.
        const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
        children.push(child);
        const pid = child.pid ?? -1;
        expect(isAlive(pid)).toBe(true);
        child.kill("SIGKILL");
        await until(() => !isAlive(pid));
    });
});

describe.skipIf(process.platform !== "linux")("findMarkedProcesses / killSessionProcesses", () => {
    it("marker is found via /proc/<pid>/environ, including non-ASCII in the path", async () => {
        const marker = `t1:/tmp/\u043a\u043e\u0440\u0435\u043d\u044c-${String(process.pid)}`; // "koren"
        const child = await spawnMarked(marker);
        await until(() => findMarkedProcesses().some((p) => p.pid === child.pid));
        expect(findMarkedProcesses().find((p) => p.pid === child.pid)?.marker).toBe(marker);
        expect(findMarkedProcesses().some((p) => p.pid === process.pid)).toBe(false);
    });

    it("kills the group leader and marked descendants outside the group; SIGTERM-deaf ones with SIGKILL", async () => {
        const marker = `t2:/tmp/r-${String(process.pid)}`;
        const leader = await spawnMarked(marker, { detached: true });
        await spawnMarked(marker, { ignoreTerm: true, detached: true });
        const stranger = await spawnMarked(`other:/tmp/x-${String(process.pid)}`);
        await until(() => findMarkedProcesses().filter((p) => p.marker === marker).length === 2);
        const killed = await killSessionProcesses(leader.pid, marker, 300);
        expect(killed).toBe(1);
        expect(findMarkedProcesses().filter((p) => p.marker === marker)).toEqual([]);
        expect(isAlive(stranger.pid ?? -1)).toBe(true);
    });

    it("without a leader, only marked ones", async () => {
        const marker = `t3:/tmp/r-${String(process.pid)}`;
        await spawnMarked(marker);
        await until(() => findMarkedProcesses().some((p) => p.marker === marker));
        expect(await killSessionProcesses(undefined, marker, 2000)).toBe(0);
        expect(findMarkedProcesses().filter((p) => p.marker === marker)).toEqual([]);
    });
});
