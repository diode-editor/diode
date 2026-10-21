import { describe, expect, it } from "vitest";

import type { LogEntry } from "../../log/common/iLogService.ts";
import { LogLevel } from "../../log/common/logLevel.ts";
import { LogService } from "../../log/common/logService.ts";
import type { ITreeFileChange } from "../common/iTreeFileWatcher.ts";

import type { IWatcherProcess } from "./subprocessTreeWatcher.ts";
import { SubprocessTreeWatcher } from "./subprocessTreeWatcher.ts";
import type { ITreeWatcherRequest, ITreeWatcherResponse } from "./treeWatcherProtocol.ts";

class FakeProcess implements IWatcherProcess {
    public readonly sent: ITreeWatcherRequest[] = [];
    public kills = 0;
    private messageListener: ((message: unknown) => void) | null = null;
    private exitListener: (() => void) | null = null;
    private errorListener: ((error: unknown) => void) | null = null;

    public send(message: ITreeWatcherRequest): void {
        this.sent.push(message);
    }

    public onMessage(listener: (message: unknown) => void): void {
        this.messageListener = listener;
    }

    public onExit(listener: () => void): void {
        this.exitListener = listener;
    }

    public onError(listener: (error: unknown) => void): void {
        this.errorListener = listener;
    }

    public kill(): void {
        this.kills++;
        this.die();
    }

    public emit(message: unknown): void {
        this.messageListener?.(message);
    }

    public die(): void {
        this.exitListener?.();
    }

    public fail(error: unknown): void {
        this.errorListener?.(error);
    }
}

function processFactory(): { spawnProcess: () => IWatcherProcess; spawned: FakeProcess[] } {
    const spawned: FakeProcess[] = [];
    return {
        spawnProcess: () => {
            const child = new FakeProcess();
            spawned.push(child);
            return child;
        },
        spawned,
    };
}

function createLogService(): { logService: LogService; entries: LogEntry[] } {
    const logService = new LogService();
    logService.setLevel("*", LogLevel.Trace);
    const entries: LogEntry[] = [];
    logService.addSink({ append: (entry) => entries.push(entry), dispose: () => undefined });
    return { logService, entries };
}

const OPTIONS = { recursive: true, excludes: [] as readonly string[] };
const CHANGES: readonly ITreeFileChange[] = [{ type: "changed", path: "/repo/a.ts" }];

describe("SubprocessTreeWatcher", () => {
    it("does not spawn the process until someone asks to watch", () => {
        const { spawnProcess, spawned } = processFactory();

        new SubprocessTreeWatcher({ spawnProcess });

        expect(spawned).toHaveLength(0);
    });

    it("the first watchTree spawns the process and sends the request there", () => {
        const { logService, entries } = createLogService();
        const { spawnProcess, spawned } = processFactory();
        const watcher = new SubprocessTreeWatcher({ spawnProcess, logger: logService.createLogger("files.watcher") });

        watcher.watchTree("/repo", { recursive: true, excludes: ["**/node_modules"] }, () => undefined);

        expect(spawned).toHaveLength(1);
        expect(spawned[0]?.sent).toEqual([
            { t: "watch", id: 1, rootPath: "/repo", options: { recursive: true, excludes: ["**/node_modules"] } },
        ]);
        // Process startup is visible in the log: otherwise there's nothing to debug "why are there two" with.
        expect(entries.map((e) => e.message)).toContain("spawning file watcher process");
    });

    it("a second request goes to the same process with its own id", () => {
        const { spawnProcess, spawned } = processFactory();
        const watcher = new SubprocessTreeWatcher({ spawnProcess });

        watcher.watchTree("/repo", OPTIONS, () => undefined);
        watcher.watchTree("/repo/.git", { recursive: false, excludes: [] }, () => undefined);

        expect(spawned).toHaveLength(1);
        expect(spawned[0]?.sent.map((m) => m.id)).toEqual([1, 2]);
    });

    it("each request sends its own excludes; the setting is live", () => {
        const { spawnProcess, spawned } = processFactory();
        const watcher = new SubprocessTreeWatcher({ spawnProcess });

        watcher.watchTree("/repo", { recursive: true, excludes: ["**/out"] }, () => undefined);
        watcher.watchTree("/repo", { recursive: true, excludes: ["**/out", "**/dist"] }, () => undefined);

        expect(spawned[0]?.sent.map((m) => (m.t === "watch" ? m.options.excludes : null))).toEqual([
            ["**/out"],
            ["**/out", "**/dist"],
        ]);
    });

    it("an event batch reaches the callback of its own request", () => {
        const { spawnProcess, spawned } = processFactory();
        const watcher = new SubprocessTreeWatcher({ spawnProcess });
        const first: ITreeFileChange[][] = [];
        const second: ITreeFileChange[][] = [];
        watcher.watchTree("/repo", OPTIONS, (changes) => first.push([...changes]));
        watcher.watchTree("/other", OPTIONS, (changes) => second.push([...changes]));

        spawned[0]?.emit({ t: "changes", id: 2, changes: CHANGES });

        expect(first).toEqual([]);
        expect(second).toEqual([CHANGES]);
    });

    it("disposing a request sends unwatch and silences its stream", () => {
        const { spawnProcess, spawned } = processFactory();
        const watcher = new SubprocessTreeWatcher({ spawnProcess });
        const seen: ITreeFileChange[][] = [];
        const subscription = watcher.watchTree("/repo", OPTIONS, (changes) => seen.push([...changes]));

        subscription.dispose();
        spawned[0]?.emit({ t: "changes", id: 1, changes: CHANGES });

        expect(spawned[0]?.sent.at(-1)).toEqual({ t: "unwatch", id: 1 });
        expect(seen).toEqual([]);
    });

    it("a repeated dispose does not send a second unwatch", () => {
        const { spawnProcess, spawned } = processFactory();
        const watcher = new SubprocessTreeWatcher({ spawnProcess });
        const subscription = watcher.watchTree("/repo", OPTIONS, () => undefined);

        subscription.dispose();
        subscription.dispose();

        expect(spawned[0]?.sent.filter((m) => m.t === "unwatch")).toHaveLength(1);
    });

    it("the process lives on with no subscribers, so the next request does not pay for a spawn", () => {
        const { spawnProcess, spawned } = processFactory();
        const watcher = new SubprocessTreeWatcher({ spawnProcess });
        watcher.watchTree("/repo", OPTIONS, () => undefined).dispose();

        watcher.watchTree("/repo", OPTIONS, () => undefined);

        expect(spawned).toHaveLength(1);
    });

    it("garbage from the process is ignored", () => {
        const { spawnProcess, spawned } = processFactory();
        const watcher = new SubprocessTreeWatcher({ spawnProcess });
        const seen: ITreeFileChange[][] = [];
        watcher.watchTree("/repo", OPTIONS, (changes) => seen.push([...changes]));

        expect(() => {
            spawned[0]?.emit({ nonsense: true });
        }).not.toThrow();
        expect(seen).toEqual([]);
    });

    it("a batch for an unknown id does not crash the host", () => {
        const { spawnProcess, spawned } = processFactory();
        const watcher = new SubprocessTreeWatcher({ spawnProcess });
        watcher.watchTree("/repo", OPTIONS, () => undefined);

        expect(() => {
            spawned[0]?.emit({ t: "changes", id: 99, changes: CHANGES });
        }).not.toThrow();
    });

    describe("watcher process diagnostics", () => {
        it("a log entry from the process goes to the host channel with its arguments", () => {
            const { logService, entries } = createLogService();
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({
                spawnProcess,
                logger: logService.createLogger("files.watcher"),
            });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            spawned[0]?.emit({
                t: "log",
                level: "warn",
                message: "tree watcher error — inotify watch limit reached",
                args: [{ code: "ENOSPC" }],
            });

            const entry = entries.at(-1);
            expect(entry?.channel).toBe("files.watcher");
            expect(entry?.level).toBe(LogLevel.Warn);
            expect(entry?.message).toContain("inotify watch limit reached");
            expect(entry?.args).toEqual([{ code: "ENOSPC" }]);
        });

        it("the entry level is preserved (error does not arrive as info)", () => {
            const { logService, entries } = createLogService();
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({
                spawnProcess,
                logger: logService.createLogger("files.watcher"),
            });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            spawned[0]?.emit({ t: "log", level: "error", message: "boom", args: [] });

            expect(entries.at(-1)?.level).toBe(LogLevel.Error);
        });

        it("without a logger an entry from the process is simply dropped", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            expect(() => {
                spawned[0]?.emit({ t: "log", level: "warn", message: "x", args: [] });
            }).not.toThrow();
        });
    });

    describe("process death", () => {
        it("live requests resubscribe to the new process", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            watcher.watchTree("/repo", { recursive: true, excludes: ["**/out"] }, () => undefined);
            watcher.watchTree("/other", { recursive: false, excludes: [] }, () => undefined);

            spawned[0]?.die();

            expect(spawned).toHaveLength(2);
            expect(spawned[1]?.sent).toEqual([
                { t: "watch", id: 1, rootPath: "/repo", options: { recursive: true, excludes: ["**/out"] } },
                { t: "watch", id: 2, rootPath: "/other", options: { recursive: false, excludes: [] } },
            ]);
        });

        it("the stream of a resubscribed request goes to the same callback", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            const seen: ITreeFileChange[][] = [];
            watcher.watchTree("/repo", OPTIONS, (changes) => seen.push([...changes]));

            spawned[0]?.die();
            spawned[1]?.emit({ t: "changes", id: 1, changes: CHANGES });

            expect(seen).toEqual([CHANGES]);
        });

        it("a removed request does not come back after a restart", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            watcher.watchTree("/repo", OPTIONS, () => undefined).dispose();

            spawned[0]?.die();

            expect(spawned).toHaveLength(1);
        });

        it("a series of deaths ends with giving up watching, not endless spawning", () => {
            const { logService, entries } = createLogService();
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({
                spawnProcess,
                logger: logService.createLogger("files.watcher"),
                maxRestarts: 2,
            });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            spawned[0]?.die();
            spawned[1]?.die();
            spawned[2]?.die();

            expect(spawned).toHaveLength(3);
            const entry = entries.at(-1);
            expect(entry?.level).toBe(LogLevel.Error);
            expect(entry?.message).toContain("file watching is disabled");
            expect(entry?.args).toEqual([{ restarts: 2, requests: 1 }]);
        });

        it("after giving up new requests no longer spawn the process", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess, maxRestarts: 0 });
            watcher.watchTree("/repo", OPTIONS, () => undefined);
            spawned[0]?.die();

            watcher.watchTree("/other", OPTIONS, () => undefined);

            expect(spawned).toHaveLength(1);
        });

        it("unsubscribing without a live process does not fail", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess, maxRestarts: 0 });
            watcher.watchTree("/repo", OPTIONS, () => undefined);
            spawned[0]?.die();
            // The process is gone but the request is alive: its owner will still release
            // the subscription at some point (extension deactivated, editor closed).
            const orphan = watcher.watchTree("/other", OPTIONS, () => undefined);

            expect(() => {
                orphan.dispose();
            }).not.toThrow();
        });

        it("a restart logs a warning, so events lost meanwhile are visible in the log", () => {
            const { logService, entries } = createLogService();
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({
                spawnProcess,
                logger: logService.createLogger("files.watcher"),
            });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            spawned[0]?.die();

            const entry = entries.find((e) => e.level === LogLevel.Warn && e.message.includes("restarting"));
            expect(entry).toBeDefined();
            expect(entry?.args).toEqual([{ restart: 1, requests: 1 }]);
        });

        it("a process that failed to start (error without exit) still leads to a restart", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            spawned[0]?.fail(Object.assign(new Error("spawn EMFILE"), { code: "EMFILE" }));

            expect(spawned).toHaveLength(2);
            expect(spawned[1]?.sent).toEqual([{ t: "watch", id: 1, rootPath: "/repo", options: OPTIONS }]);
        });

        it("a process failure shows in the log with the error code", () => {
            const { logService, entries } = createLogService();
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({
                spawnProcess,
                logger: logService.createLogger("files.watcher"),
            });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            spawned[0]?.fail(Object.assign(new Error("spawn EMFILE"), { code: "EMFILE" }));

            const entry = entries.find((e) => e.message.includes("file watcher process error"));
            expect(entry?.channel).toBe("files.watcher");
            expect(entry?.args).toEqual([{ code: "EMFILE", error: "Error: spawn EMFILE" }]);
        });

        it("exit after a handled error does not spawn a second process", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            spawned[0]?.fail(new Error("spawn ENOENT"));
            // Node doesn't promise `exit` after `error`, but doesn't rule it out either.
            spawned[0]?.die();

            expect(spawned).toHaveLength(2);
        });

        it("a channel error of an already removed process does not touch the new one or litter the log", () => {
            const { logService, entries } = createLogService();
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({
                spawnProcess,
                logger: logService.createLogger("files.watcher"),
            });
            watcher.watchTree("/repo", OPTIONS, () => undefined);
            spawned[0]?.die();

            // ERR_IPC_CHANNEL_CLOSED from `send` into a dead channel arrives after the replacement is already up.
            spawned[0]?.fail(new Error("ERR_IPC_CHANNEL_CLOSED"));

            expect(spawned).toHaveLength(2);
            expect(entries.filter((e) => e.message.includes("file watcher process error"))).toEqual([]);
        });

        it("an error without an errno code is logged without failing", () => {
            const { logService, entries } = createLogService();
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({
                spawnProcess,
                logger: logService.createLogger("files.watcher"),
            });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            // The seam contract is `unknown`: error parsing must never throw itself,
            // or we'd bring back exactly the editor crash we're moving away from.
            expect(() => {
                spawned[0]?.fail(undefined);
            }).not.toThrow();

            const entry = entries.find((e) => e.message.includes("file watcher process error"));
            expect(entry?.args).toEqual([{ code: undefined, error: "undefined" }]);
        });

        it("deaths are counted CONSECUTIVELY: surviving the working period resets the count", () => {
            const { spawnProcess, spawned } = processFactory();
            let clock = 0;
            const watcher = new SubprocessTreeWatcher({ spawnProcess, maxRestarts: 1, now: () => clock });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            spawned[0]?.die(); // first death: restart (the budget is now spent)
            clock += 60_000; // the second process lived out its healthy lifetime
            spawned[1]?.die(); // so this is a "first" death again, not a second one
            clock += 60_000;
            spawned[2]?.die();

            expect(spawned).toHaveLength(4);
        });

        it("deaths within the working period do not reset the count", () => {
            const { spawnProcess, spawned } = processFactory();
            let clock = 0;
            const watcher = new SubprocessTreeWatcher({ spawnProcess, maxRestarts: 1, now: () => clock });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            spawned[0]?.die();
            clock += 59_999;
            spawned[1]?.die();

            expect(spawned).toHaveLength(2);
        });

        it("a late exit of the old process does not touch the new one", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            watcher.watchTree("/repo", OPTIONS, () => undefined);
            spawned[0]?.die();

            spawned[0]?.die();

            expect(spawned).toHaveLength(2);
        });
    });

    describe("dispose", () => {
        it("kills the process synchronously", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            watcher.dispose();

            expect(spawned[0]?.kills).toBe(1);
        });

        it("a killed process is not respawned: the window is going away, not recovering", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            watcher.dispose();

            expect(spawned).toHaveLength(1);
        });

        it("a batch arriving after dispose does not reach the subscriber", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            const seen: ITreeFileChange[][] = [];
            watcher.watchTree("/repo", OPTIONS, (changes) => seen.push([...changes]));

            watcher.dispose();
            spawned[0]?.emit({ t: "changes", id: 1, changes: CHANGES });

            expect(seen).toEqual([]);
        });

        it("dispose without a spawned process is a no-op", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });

            expect(() => {
                watcher.dispose();
            }).not.toThrow();
            expect(spawned).toHaveLength(0);
        });

        it("a repeated dispose does not kill a second time", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            watcher.watchTree("/repo", OPTIONS, () => undefined);

            watcher.dispose();
            watcher.dispose();

            expect(spawned[0]?.kills).toBe(1);
        });

        it("a request after dispose does not spawn the process", () => {
            const { spawnProcess, spawned } = processFactory();
            const watcher = new SubprocessTreeWatcher({ spawnProcess });
            watcher.dispose();

            watcher.watchTree("/repo", OPTIONS, () => undefined);

            expect(spawned).toHaveLength(0);
        });
    });
});
