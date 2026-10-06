import { type ChildProcess, spawn } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { findMarkedProcesses, isAlive, killSessionProcesses } from "./processes.ts";
import { SESSION_MARKER_ENV } from "./sessionRegistry.ts";

const children: ChildProcess[] = [];
afterEach(() => {
    for (const c of children.splice(0)) c.kill("SIGKILL");
});

/** Долгоживущий node с маркером; `detached` — лидер своей группы, как редактор сессии. */
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
    // Сигнал до установки обработчика убил бы «глухого» раньше времени.
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
    it("свой процесс жив, несуществующий pid — нет", () => {
        expect(isAlive(process.pid)).toBe(true);
        expect(isAlive(2 ** 22 + 12345)).toBe(false);
    });
});

describe.skipIf(process.platform !== "linux")("isAlive — зомби", () => {
    it("непожатый ребёнок после SIGKILL — мёртв, хотя kill(pid, 0) его видит", async () => {
        // Ребёнок с `ignore`-stdio и без слушателя exit: libuv пожнёт его не сразу —
        // ловим окно, пока он зомби, по /proc.
        const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
        children.push(child);
        const pid = child.pid ?? -1;
        expect(isAlive(pid)).toBe(true);
        child.kill("SIGKILL");
        await until(() => !isAlive(pid));
    });
});

describe.skipIf(process.platform !== "linux")("findMarkedProcesses / killSessionProcesses", () => {
    it("маркер находится по /proc/<pid>/environ, в т.ч. не-ASCII в пути", async () => {
        const marker = `t1:/tmp/корень-${String(process.pid)}`;
        const child = await spawnMarked(marker);
        await until(() => findMarkedProcesses().some((p) => p.pid === child.pid));
        expect(findMarkedProcesses().find((p) => p.pid === child.pid)?.marker).toBe(marker);
        expect(findMarkedProcesses().some((p) => p.pid === process.pid)).toBe(false);
    });

    it("гасит лидера группы и маркерных потомков вне группы; SIGTERM-глухих — SIGKILL'ом", async () => {
        const marker = `t2:/tmp/r-${String(process.pid)}`;
        const leader = await spawnMarked(marker, { detached: true });
        await spawnMarked(marker, { ignoreTerm: true, detached: true });
        const stranger = await spawnMarked(`other:/tmp/x-${String(process.pid)}`);
        await until(() => findMarkedProcesses().filter((p) => p.marker === marker).length === 2);
        const killed = await killSessionProcesses(leader.pid, marker, 300);
        expect(killed).toBe(1); // глухой к SIGTERM — добит SIGKILL
        expect(findMarkedProcesses().filter((p) => p.marker === marker)).toEqual([]);
        expect(isAlive(stranger.pid ?? -1)).toBe(true);
    });

    it("без лидера — только маркерные", async () => {
        const marker = `t3:/tmp/r-${String(process.pid)}`;
        await spawnMarked(marker);
        await until(() => findMarkedProcesses().some((p) => p.marker === marker));
        expect(await killSessionProcesses(undefined, marker, 2000)).toBe(0);
        expect(findMarkedProcesses().filter((p) => p.marker === marker)).toEqual([]);
    });
});
