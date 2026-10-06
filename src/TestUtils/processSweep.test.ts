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

/** Таблица процессов из литерала: pid → окружение (`null` — недоступно). */
function fakeTable(procs: Record<number, string[] | null>, parents: Record<number, number> = {}): ProcessTable {
    return {
        pids: () => Object.keys(procs).map(Number),
        environ: (pid) => procs[pid] ?? null,
        command: (pid) => `cmd-${String(pid)}`,
        parent: (pid) => parents[pid] ?? 1,
    };
}

describe("processSweep — процессы по метке в окружении", () => {
    describe("findByEnv", () => {
        it("находит ровно тех, у кого метка с этим значением", () => {
            const table = fakeTable({
                10: ["PATH=/bin", "MARK=a"],
                11: ["MARK=ab"], // префикс значения — не совпадение
                12: ["XMARK=a"], // суффикс имени — тоже
                13: null, // чужой или уже вышел
                14: ["MARK=a"],
            });

            expect(findByEnv("MARK", "a", table)).toEqual([
                { pid: 10, command: "cmd-10" },
                { pid: 14, command: "cmd-14" },
            ]);
        });

        it("себя и своих прямых детей не находит никогда — даже с меткой; внуков находит", () => {
            const table = fakeTable(
                { [process.pid]: ["MARK=a"], 40: ["MARK=a"], 41: ["MARK=a"] },
                { 40: process.pid, 41: 40 }, // 40 — воркер пула, 41 — запущенный им редактор
            );

            expect(findByEnv("MARK", "a", table)).toEqual([{ pid: 41, command: "cmd-41" }]);
        });

        it("без таблицы процессов (не Linux) — пусто", () => {
            expect(findByEnv("MARK", "a", null)).toEqual([]);
        });
    });

    describe("killByEnv", () => {
        it("шлёт SIGKILL каждому найденному и возвращает тех, кому сигнал ушёл", () => {
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
        it("ждёт, пока процессы выйдут сами, и тогда не добивает никого", async () => {
            let polls = 0;
            const table: ProcessTable = {
                pids: () => [30],
                // Первые два опроса процесс ещё жив, потом вышел сам.
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

        it("кто не вышел за отведённое время — добит", async () => {
            const table = fakeTable({ 31: ["MARK=a"] });
            const kill = vi.fn();
            const started = Date.now();

            const killed = await reapByEnv("MARK", "a", { table, kill, graceMs: 50, pollMs: 5 });

            expect(Date.now() - started).toBeGreaterThanOrEqual(45);
            expect(killed).toEqual([{ pid: 31, command: "cmd-31" }]);
            expect(kill).toHaveBeenCalledWith(31, "SIGKILL");
        });

        it("по умолчанию даёт две секунды и опрашивает часто", async () => {
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
                // Ещё в пределах дефолтной отсрочки: никого не добили.
                expect(kill).not.toHaveBeenCalled();
                alive = false;
                await vi.advanceTimersByTimeAsync(100);

                expect(await reaping).toEqual([]);
            } finally {
                vi.useRealTimers();
            }
        });
    });

    it("describeKilled — pid и усечённая командная строка, по строке на процесс", () => {
        const long = "x".repeat(300);

        expect(
            describeKilled([
                { pid: 1, command: "a b" },
                { pid: 2, command: long },
            ]),
        ).toBe(`  1 a b\n  2 ${"x".repeat(200)}`);
    });

    it("parseParentPid — четвёртое поле после последней скобки имени", () => {
        expect(parseParentPid("123 (sleep) S 45 123 45 0")).toBe(45);
        // имя с пробелами и скобками
        expect(parseParentPid("123 (a) b (c)) R 7 1 1")).toBe(7);
        expect(parseParentPid("мусор")).toBeNull();
    });

    it("таблицы процессов нет вне Linux", () => {
        expect(createProcTable("darwin")).toBeNull();
        expect(createProcTable("win32")).toBeNull();
    });

    describe.skipIf(process.platform !== "linux")("настоящий /proc", () => {
        const children: ChildProcess[] = [];

        afterEach(() => {
            // Всей группе: убитый в одиночку `sh` оставил бы `sleep` сиротой (это и
            // поймал teardown корня прогона, когда тест убивал только `sh`).
            for (const child of children.splice(0)) {
                try {
                    process.kill(-child.pid!, "SIGKILL");
                } catch {
                    // группа уже пуста
                }
            }
        });

        function spawnMarked(value: string): ChildProcess {
            // Внук, а не ребёнок: прямых детей поиск пропускает намеренно. `sh` держит
            // `sleep` своим ребёнком (без exec — за ним ещё команда).
            const child = spawn("sh", ["-c", "sleep 30; true"], {
                env: { ...process.env, SWEEP_TEST_MARK: value },
                stdio: "ignore",
                detached: true, // своя группа — afterEach убивает её целиком
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

        /** Ждёт, пока `sh` запустит своего `sleep`, и отдаёт найденных. */
        async function waitFound(value: string): Promise<ReturnType<typeof findByEnv>> {
            for (let i = 0; i < 100; i++) {
                const found = findByEnv("SWEEP_TEST_MARK", value);
                if (found.length > 0) return found;
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            return [];
        }

        it("находит и убивает внука с меткой, не трогая ни прямого ребёнка, ни соседа", async () => {
            const marked = spawnMarked("run-1");
            const neighbour = spawnMarked("run-2");
            const markedExit = exited(marked);

            const found = await waitFound("run-1");
            // Только `sleep`: сам `sh` — прямой ребёнок этого процесса, его пропускаем.
            expect(found).toHaveLength(1);
            expect(found[0]?.pid).not.toBe(marked.pid);
            expect(found[0]?.command).toBe("sleep 30");
            expect(procTable?.parent(found[0].pid)).toBe(marked.pid);

            expect(killByEnv("SWEEP_TEST_MARK", "run-1")).toEqual(found);
            // `sleep` убит — `sh` доходит до `true` и выходит сам, кодом 0.
            expect(await markedExit).toBe(0);
            expect(neighbour.exitCode).toBeNull();
            expect(await waitFound("run-2")).toHaveLength(1);
        });

        it("таблица видит текущие процессы, а исчезнувший — пустой", () => {
            expect(procTable?.pids()).toContain(process.pid);
            expect(procTable?.command(process.pid)).toContain("node");
            // pid за пределом pid_max (2^22) не существует никогда.
            const missing = 2 ** 23;
            expect(procTable?.environ(missing)).toBeNull();
            expect(procTable?.command(missing)).toBe("");
            expect(procTable?.parent(missing)).toBeNull();
            expect(procTable?.parent(process.pid)).toBe(process.ppid);
        });
    });
});
