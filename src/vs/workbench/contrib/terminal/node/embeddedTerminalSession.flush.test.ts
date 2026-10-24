import { afterEach, describe, expect, it, vi } from "vitest";

import { Emitter } from "../../../../base/common/event.ts";

import { DATA_FLUSH_TIMEOUT_MS, EmbeddedTerminalSession } from "./embeddedTerminalSession.ts";

// Upstream `_queueProcessExit`: node-pty can report the exit before the last output is read, so the session's exit
// waits until the output has been quiet for DATA_FLUSH_TIMEOUT_MS. A fake pty controls the order of the events.

const fake = vi.hoisted(() => ({
    ptys: [] as { data: (d: string) => void; exit: (code: number) => void; calls: string[] }[],
}));

vi.mock("./loadNodePty.ts", () => ({
    loadNodePty: () => ({
        spawn: () => {
            const data = new Emitter<string>();
            const exit = new Emitter<{ exitCode: number }>();
            const calls: string[] = [];
            fake.ptys.push({
                data: (d) => {
                    data.fire(d);
                },
                exit: (exitCode) => {
                    exit.fire({ exitCode });
                },
                calls,
            });
            return {
                pid: 1,
                onData: data.event,
                onExit: exit.event,
                write: (d: string) => calls.push(`write ${d}`),
                resize: (cols: number, rows: number) => calls.push(`resize ${String(cols)}x${String(rows)}`),
                kill: () => undefined,
            };
        },
    }),
}));

afterEach(() => {
    fake.ptys.length = 0;
    vi.useRealTimers();
});

describe("EmbeddedTerminalSession — output after the process exit", () => {
    it("the exit waits for the output to be quiet: a chunk after the pty's exit restarts the wait", async () => {
        const session = new EmbeddedTerminalSession({ cols: 40, rows: 4 });
        await session.xtermReady;
        vi.useFakeTimers();
        const lines: string[] = [];
        session.onLineData((line) => lines.push(line));
        const exits: number[] = [];
        session.onExit((code) => exits.push(code));
        const [pty] = fake.ptys;
        pty.data("first\r\n");
        pty.exit(3);
        vi.advanceTimersByTime(DATA_FLUSH_TIMEOUT_MS - 1);
        pty.data("late\r\n");
        vi.advanceTimersByTime(DATA_FLUSH_TIMEOUT_MS - 1);
        expect(exits).toStrictEqual([]);
        vi.advanceTimersByTime(1);
        // The emulator parses the output (its own timers) before the exit event.
        await vi.runAllTimersAsync();
        expect(exits).toStrictEqual([3]);
        expect(lines).toStrictEqual(["first", "late"]);
        session.dispose();
    });

    it("during the wait input and resize don't reach the exited pty (its fd is closed: a resize threw EBADF)", async () => {
        const session = new EmbeddedTerminalSession({ cols: 40, rows: 4 });
        await session.xtermReady;
        const [pty] = fake.ptys;
        session.resize(50, 5);
        session.write("a");
        pty.exit(0);
        session.resize(60, 6);
        session.write("b");
        expect(pty.calls).toStrictEqual(["resize 50x5", "write a"]);
        session.dispose();
    });

    it("disposing during the wait: no exit event", async () => {
        const session = new EmbeddedTerminalSession({ cols: 40, rows: 4 });
        await session.xtermReady;
        vi.useFakeTimers();
        const exits: number[] = [];
        session.onExit((code) => exits.push(code));
        fake.ptys[0].exit(0);
        session.dispose();
        vi.advanceTimersByTime(DATA_FLUSH_TIMEOUT_MS * 2);
        expect(exits).toStrictEqual([]);
    });
});
