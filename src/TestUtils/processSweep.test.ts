import { type ChildProcess, spawn } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
    createProcTable,
    describeKilled,
    findByEnv,
    killByEnv,
    parseParentPid,
    type ProcessTable,
    procTable,
    reapByEnv,
} from "./processSweep.ts";

function fakeTable(procs: Record<number, string[] | null>, parents: Record<number, number> = {}): ProcessTable {
    return {
        pids: () => Object.keys(procs).map(Number),
        environ: (pid) => procs[pid] ?? null,
        command: (pid) => `cmd-${String(pid)}`,
        parent: (pid) => parents[pid] ?? 1,
    };
}

describe("processSweep — processes by environment tag", () => {
    describe("findByEnv", () => {
        it("finds exactly those whose tag has this value", () => {
            const table = fakeTable({
                10: ["PATH=/bin", "MARK=a"],
                11: ["MARK=ab"], // value prefix — not a match
                12: ["XMARK=a"], // name suffix — neither
                13: null, // foreign or already exited
                14: ["MARK=a"],
            });

            expect(findByEnv("MARK", "a", table)).toEqual([
                { pid: 10, command: "cmd-10" },
                { pid: 14, command: "cmd-14" },
            ]);
        });

        it("never finds itself or its direct children, even tagged; finds grandchildren", () => {
            const table = fakeTable(
                { [process.pid]: ["MARK=a"], 40: ["MARK=a"], 41: ["MARK=a"] },
                { 40: process.pid, 41: 40 }, // 40 is a pool worker, 41 is the editor it spawned
            );

            expect(findByEnv("MARK", "a", table)).toEqual([{ pid: 41, command: "cmd-41" }]);
        });

        it("no process table (not Linux) — empty", () => {
            expect(findByEnv("MARK", "a", null)).toEqual([]);
        });
    });

    describe("killByEnv", () => {
        it("sends SIGKILL to each found process and returns those signaled", () => {
            const table = fakeTable({ 20: ["MARK=a"], 21: ["MARK=a"], 22: ["MARK=b"] });
            const kill = vi.fn((pid: number) => {
                if (pid === 21) throw Object.assign(new Error("gone"), { code: "ESRCH" });
            });

            const killed = killByEnv("MARK", "a", { table, kill });

            expect(kill.mock.calls).toEqual([
                [20, "SIGKILL"],
                [21, "SIGKILL"],
            ]);
            expect(killed).toEqual([{ pid: 20, command: "cmd-20" }]);
        });
    });

    describe("reapByEnv", () => {
        it("waits for processes to exit on their own and then kills no one", async () => {
            let polls = 0;
            const table: ProcessTable = {
                pids: () => [30],
                environ: () => (polls++ < 2 ? ["MARK=a"] : null),
                command: () => "lsp",
                parent: () => 1,
            };
            const kill = vi.fn();

            const killed = await reapByEnv("MARK", "a", { table, kill, graceMs: 5000, pollMs: 1 });

            expect(killed).toEqual([]);
            expect(kill).not.toHaveBeenCalled();
            expect(polls).toBeGreaterThanOrEqual(3);
        });

        it("whoever has not exited in time is killed", async () => {
            const table = fakeTable({ 31: ["MARK=a"] });
            const kill = vi.fn();
            const started = Date.now();

            const killed = await reapByEnv("MARK", "a", { table, kill, graceMs: 50, pollMs: 5 });

            expect(Date.now() - started).toBeGreaterThanOrEqual(45);
            expect(killed).toEqual([{ pid: 31, command: "cmd-31" }]);
            expect(kill).toHaveBeenCalledWith(31, "SIGKILL");
        });

        it("by default allows two seconds and polls often", async () => {
            vi.useFakeTimers();
            try {
                let alive = true;
                const table: ProcessTable = {
                    pids: () => [32],
                    environ: () => (alive ? ["MARK=a"] : null),
                    command: () => "lsp",
                    parent: () => 1,
                };
                const kill = vi.fn();
                const reaping = reapByEnv("MARK", "a", { table, kill });

                await vi.advanceTimersByTimeAsync(1900);
                expect(kill).not.toHaveBeenCalled();
                alive = false;
                await vi.advanceTimersByTimeAsync(100);

                expect(await reaping).toEqual([]);
            } finally {
                vi.useRealTimers();
            }
        });
    });

    it("describeKilled — pid and truncated command line, one line per process", () => {
        const long = "x".repeat(300);

        expect(
            describeKilled([
                { pid: 1, command: "a b" },
                { pid: 2, command: long },
            ]),
        ).toBe(`  1 a b\n  2 ${"x".repeat(200)}`);
    });

    it("parseParentPid — fourth field after the name's last paren", () => {
        expect(parseParentPid("123 (sleep) S 45 123 45 0")).toBe(45);
        expect(parseParentPid("123 (a) b (c)) R 7 1 1")).toBe(7);
        expect(parseParentPid("garbage")).toBeNull();
    });

    it("no process table outside Linux", () => {
        expect(createProcTable("darwin")).toBeNull();
        expect(createProcTable("win32")).toBeNull();
    });

    describe.skipIf(process.platform !== "linux")("real /proc", () => {
        const children: ChildProcess[] = [];

        afterEach(() => {
            // The whole group: killing `sh` alone would orphan `sleep`.
            for (const child of children.splice(0)) {
                try {
                    process.kill(-child.pid!, "SIGKILL");
                } catch {
                    // group is already empty
                }
            }
        });

        function spawnMarked(value: string): ChildProcess {
            // A grandchild, not a child: the search skips direct children. `; true` keeps `sh` from exec-ing.
            const child = spawn("sh", ["-c", "sleep 30; true"], {
                env: { ...process.env, SWEEP_TEST_MARK: value },
                stdio: "ignore",
                detached: true,
            });
            children.push(child);
            return child;
        }

        function exited(child: ChildProcess): Promise<number | null> {
            return new Promise((resolve) =>
                child.once("exit", (code) => {
                    resolve(code);
                }),
            );
        }

        async function waitFound(value: string): Promise<ReturnType<typeof findByEnv>> {
            for (let i = 0; i < 100; i++) {
                const found = findByEnv("SWEEP_TEST_MARK", value);
                if (found.length > 0) return found;
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            return [];
        }

        it("finds and kills the tagged grandchild, sparing the direct child and the neighbor", async () => {
            const marked = spawnMarked("run-1");
            const neighbour = spawnMarked("run-2");
            const markedExit = exited(marked);

            const found = await waitFound("run-1");
            expect(found).toHaveLength(1);
            expect(found[0]?.pid).not.toBe(marked.pid);
            expect(found[0]?.command).toBe("sleep 30");
            expect(procTable?.parent(found[0].pid)).toBe(marked.pid);

            expect(killByEnv("SWEEP_TEST_MARK", "run-1")).toEqual(found);
            expect(await markedExit).toBe(0);
            expect(neighbour.exitCode).toBeNull();
            expect(await waitFound("run-2")).toHaveLength(1);
        });

        it("table sees live processes, a vanished one is empty", () => {
            expect(procTable?.pids()).toContain(process.pid);
            expect(procTable?.command(process.pid)).toContain("node");
            // Beyond pid_max (2^22).
            const missing = 2 ** 23;
            expect(procTable?.environ(missing)).toBeNull();
            expect(procTable?.command(missing)).toBe("");
            expect(procTable?.parent(missing)).toBeNull();
            expect(procTable?.parent(process.pid)).toBe(process.ppid);
        });
    });
});
