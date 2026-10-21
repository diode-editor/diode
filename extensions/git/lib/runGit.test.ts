import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runGit } from "./runGit.ts";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const { spawn } = await import("node:child_process");
const spawnMock = vi.mocked(spawn);

class FakeChild extends EventEmitter {
    public readonly stdout = new EventEmitter();
    public readonly stderr = new EventEmitter();
    public killed = false;
    public readonly signals: string[] = [];

    public kill(signal?: string): boolean {
        const sig = signal ?? "SIGTERM";
        this.signals.push(sig);
        this.killed = true;
        // A killed child closes; `code === null` models "died by signal".
        this.emit("close", null, sig);
        return true;
    }
}

afterEach(() => {
    spawnMock.mockReset();
});

describe("runGit — spawn failure", () => {
    it("resolves to { error } when the git binary cannot be spawned (ENOENT)", async () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);

        const promise = runGit(["status"]);
        const error = new Error("spawn git ENOENT");
        child.emit("error", error);

        expect(await promise).toEqual({ error });
    });

    it("ignores a later close event once it has resolved with an error", async () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);

        const promise = runGit(["status"]);
        const error = new Error("boom");
        child.emit("error", error);
        child.emit("close", 0, null); // second settle is a no-op

        expect(await promise).toEqual({ error });
    });
});

describe("runGit — exit codes", () => {
    it("resolves with code + streams on success (exit 0)", async () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);

        const promise = runGit(["rev-parse", "HEAD"]);
        child.stdout.emit("data", Buffer.from("abc123\n"));
        child.emit("close", 0, null);

        expect(await promise).toEqual({ code: 0, stdout: "abc123\n", stderr: "" });
    });

    it("resolves (does not reject) on a non-zero exit, concatenating chunks", async () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);

        const promise = runGit(["status"], { cwd: "/repo" });
        child.stdout.emit("data", Buffer.from("out-part "));
        child.stdout.emit("data", Buffer.from("more"));
        child.stderr.emit("data", Buffer.from("fatal: not a git repository"));
        child.emit("close", 128, null);

        expect(await promise).toEqual({
            code: 128,
            stdout: "out-part more",
            stderr: "fatal: not a git repository",
        });
        expect(spawnMock).toHaveBeenCalledWith("git", ["status"], {
            cwd: "/repo",
            env: undefined,
        });
    });

    it("forwards a custom env to spawn", async () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);

        const promise = runGit(["log"], { env: { GIT_PAGER: "cat" } });
        child.emit("close", 0, null);
        await promise;

        expect(spawnMock).toHaveBeenCalledWith("git", ["log"], {
            cwd: undefined,
            env: { GIT_PAGER: "cat" },
        });
    });
});

describe("runGit — timeout", () => {
    it("kills the child with SIGKILL after the timeout and resolves with code -1", async () => {
        vi.useFakeTimers();
        try {
            const child = new FakeChild();
            spawnMock.mockReturnValue(child as never);

            const promise = runGit(["status"], { timeoutMs: 50 });
            vi.advanceTimersByTime(50);

            expect(child.signals).toEqual(["SIGKILL"]);
            expect(await promise).toEqual({ code: -1, stdout: "", stderr: "" });
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("runGit — de-duplication", () => {
    it("shares one subprocess and one promise for identical in-flight calls", async () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);

        const first = runGit(["status", "-z"]);
        const second = runGit(["status", "-z"]);

        expect(second).toBe(first);
        expect(spawnMock).toHaveBeenCalledTimes(1);

        child.emit("close", 0, null);
        await first;
    });

    it("spawns anew once the previous identical call has settled", async () => {
        const child1 = new FakeChild();
        spawnMock.mockReturnValue(child1 as never);
        const first = runGit(["status", "-z"]);
        child1.emit("close", 0, null);
        await first;

        const child2 = new FakeChild();
        spawnMock.mockReturnValue(child2 as never);
        const third = runGit(["status", "-z"]);
        expect(spawnMock).toHaveBeenCalledTimes(2);
        child2.emit("close", 0, null);
        await third;
    });

    it("does not de-duplicate calls with the same args but different cwd", async () => {
        const childX = new FakeChild();
        const childY = new FakeChild();
        spawnMock.mockReturnValueOnce(childX as never).mockReturnValueOnce(childY as never);

        const inX = runGit(["status"], { cwd: "/x" });
        const inY = runGit(["status"], { cwd: "/y" });

        expect(inY).not.toBe(inX);
        expect(spawnMock).toHaveBeenCalledTimes(2);

        childX.emit("close", 0, null);
        childY.emit("close", 0, null);
        await Promise.all([inX, inY]);
    });
});
