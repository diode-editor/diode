import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { GuardedChildProcess, type IChildProcessEnd, splitLines } from "./childProcessGuard.ts";

function recordingLogger(): { warn(message: string): void; lines: string[] } {
    const lines: string[] = [];
    return {
        lines,
        warn: (message) => {
            lines.push(message);
        },
    };
}

/** Waits for the process to end and returns all its endings (there must be exactly one). */
function ends(guard: GuardedChildProcess): { all: IChildProcessEnd[]; first: Promise<IChildProcessEnd> } {
    const all: IChildProcessEnd[] = [];
    const first = new Promise<IChildProcessEnd>((resolve) => {
        guard.onDidEnd((end) => {
            all.push(end);
            resolve(end);
        });
    });
    return { all, first };
}

function node(script: string, stdio: "pipe" | "ignore" = "pipe") {
    return spawn(process.execPath, ["-e", script], { stdio: ["ignore", stdio, stdio] });
}

/** A child without stdio whose `exit` and `close` are emitted by hand, so the test controls the order. */
function scriptedChild(): ChildProcess {
    const child = new EventEmitter() as EventEmitter & { stdin: null; stdout: null; stderr: null };
    child.stdin = null;
    child.stdout = null;
    child.stderr = null;
    return child as unknown as ChildProcess;
}

describe("GuardedChildProcess: exit or close", () => {
    it("by default the end is on exit; close is not needed", () => {
        const child = scriptedChild();
        const guard = new GuardedChildProcess(child, { label: "t" });
        const { all } = ends(guard);

        child.emit("exit", 0, null);

        expect(all).toEqual([{ code: 0, signal: null }]);
    });

    it("waitForStdio: exit is not the end yet; the end is on close (output fully read)", () => {
        const child = scriptedChild();
        const guard = new GuardedChildProcess(child, { label: "t", waitForStdio: true });
        const { all } = ends(guard);

        child.emit("exit", 0, null);
        expect(all).toEqual([]);

        child.emit("close", 0, null);
        expect(all).toEqual([{ code: 0, signal: null }]);
    });
});

describe("GuardedChildProcess", () => {
    it("exit is the end with a code, exactly once", async () => {
        const guard = new GuardedChildProcess(node("process.exit(3)"), { label: "t" });
        const { all, first } = ends(guard);

        expect(await first).toEqual({ code: 3, signal: null });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(all).toHaveLength(1);
        guard.dispose();
    });

    it("waitForStdio: the end comes after the output is fully read", async () => {
        const child = node('process.stdout.write("a\\nb\\n"); process.exit(0)');
        const guard = new GuardedChildProcess(child, { label: "t", waitForStdio: true });
        const lines: string[] = [];
        splitLines(child.stdout!, (line) => lines.push(line));
        const { first } = ends(guard);

        await first;

        expect(lines).toEqual(["a", "b"]);
        guard.dispose();
    });

    it("failed spawn: error without exit is also the end, with the error (the owner logs it, not the guard)", async () => {
        const logger = recordingLogger();
        const guard = new GuardedChildProcess(spawn("/nonexistent/diode-binary"), { label: "rg", logger });
        const { first } = ends(guard);

        const end = await first;

        expect(end.code).toBeNull();
        expect(end.signal).toBeNull();
        expect((end.error as NodeJS.ErrnoException).code).toBe("ENOENT");
        expect(logger.lines).toEqual([]);
        guard.dispose();
    });

    it("a repeated error (closed IPC channel on every send) does not crash the process or produce a second end", async () => {
        const logger = recordingLogger();
        const child = node("setTimeout(() => {}, 10_000)");
        const guard = new GuardedChildProcess(child, { label: "t", logger });
        const { all } = ends(guard);

        child.emit("error", new Error("ERR_IPC_CHANNEL_CLOSED"));
        child.emit("error", new Error("ERR_IPC_CHANNEL_CLOSED"));

        expect(all).toHaveLength(1);
        expect(all[0].error).toBeInstanceOf(Error);
        expect(logger.lines).toEqual(["[t] process error after end: Error: ERR_IPC_CHANNEL_CLOSED"]);
        guard.dispose();
    });

    it("an error on a stdio stream does not crash the process, with or without a logger", () => {
        const logger = recordingLogger();
        const child = node("setTimeout(() => {}, 10_000)");
        const guard = new GuardedChildProcess(child, { label: "w", logger });
        const quiet = node("setTimeout(() => {}, 10_000)");
        const quietGuard = new GuardedChildProcess(quiet, { label: "q" });

        child.stderr?.emit("error", new Error("EPIPE"));
        child.stdout?.emit("error", new Error("EPIPE"));
        quiet.stderr?.emit("error", new Error("EPIPE"));
        quiet.emit("error", new Error("boom"));
        quiet.emit("error", new Error("boom again"));

        expect(logger.lines).toEqual([
            "[w] stderr stream error: Error: EPIPE",
            "[w] stdout stream error: Error: EPIPE",
        ]);
        guard.dispose();
        quietGuard.dispose();
    });

    it("logStderr: stderr goes line by line to warn with a label; a tail without a newline goes at the end", async () => {
        const logger = recordingLogger();
        const child = node('process.stderr.write("first\\nsecond\\r\\ntail"); process.exit(0)');
        const guard = new GuardedChildProcess(child, {
            label: "file-watcher",
            logger,
            logStderr: true,
            waitForStdio: true,
        });
        const { first } = ends(guard);

        await first;

        expect(logger.lines).toEqual(["[file-watcher] first", "[file-watcher] second", "[file-watcher] tail"]);
        guard.dispose();
    });

    it("without logStderr, stderr is not read and not logged", async () => {
        const logger = recordingLogger();
        const child = node('process.stderr.write("noise\\n"); process.exit(0)');
        const guard = new GuardedChildProcess(child, { label: "t", logger });
        const { first } = ends(guard);

        await first;

        expect(logger.lines).toEqual([]);
        guard.dispose();
    });

    it("logStderr with stderr: ignore has nothing to read and does not fail", async () => {
        const child = node("process.exit(0)", "ignore");
        const guard = new GuardedChildProcess(child, { label: "t", logStderr: true });
        const { first } = ends(guard);

        expect(await first).toEqual({ code: 0, signal: null });
        guard.dispose();
    });

    it("dispose is a synchronous SIGKILL; an owner that disposed the process itself gets no end", async () => {
        const guard = new GuardedChildProcess(node("setInterval(() => {}, 1000)"), { label: "t" });
        const { all } = ends(guard);
        const died = new Promise<NodeJS.Signals | null>((resolve) => {
            guard.child.once("exit", (_code, signal) => {
                resolve(signal);
            });
        });

        guard.dispose();

        expect(guard.child.killed).toBe(true);
        expect(await died).toBe("SIGKILL");
        expect(all).toEqual([]);
    });
});

describe("splitLines", () => {
    it("splits on \\n, strips \\r, joins a line across chunk boundaries", () => {
        const stream = new PassThrough();
        const lines: string[] = [];
        splitLines(stream, (line) => lines.push(line));

        stream.write("one\r\nin\rside\r\ntw");
        stream.write("o\nthree");
        stream.end();

        return new Promise<void>((resolve) => {
            stream.on("end", () => {
                // Only a `\r` before a newline is stripped, not any.
                expect(lines).toEqual(["one", "in\rside", "two", "three"]);
                resolve();
            });
        });
    });

    it("an empty tail at stream end adds no extra line", async () => {
        const stream = new PassThrough();
        const lines: string[] = [];
        splitLines(stream, (line) => lines.push(line));
        const ended = new Promise((resolve) => stream.on("end", resolve));

        stream.end("only\n");
        await ended;

        expect(lines).toEqual(["only"]);
    });
});
