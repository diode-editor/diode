import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { IFileWatcherDIToken } from "../../platform/files/common/iFileWatcherDIToken.ts";
import { ITreeFileWatcherDIToken } from "../../platform/files/common/iTreeFileWatcherDIToken.ts";
import { ChokidarFileWatcher } from "../../platform/files/node/chokidarFileWatcher.ts";
import { SubprocessTreeWatcherDIToken } from "../../platform/files/node/subprocessTreeWatcher.ts";
import { Container } from "../../platform/instantiation/common/diContainer.ts";
import type { LogEntry } from "../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../platform/log/common/iLogServiceDIToken.ts";
import { LogLevel } from "../../platform/log/common/logLevel.ts";
import { LogService } from "../../platform/log/common/logService.ts";
import { DialogService } from "../../workbench/services/dialogs/browser/dialogService.ts";
import {
    LifecycleService,
    LifecycleServiceDIToken,
} from "../../workbench/services/lifecycle/browser/lifecycleService.ts";

import { fileWatcherModule } from "./fileWatcherModule.ts";

// The real process is covered end-to-end in treeWatcherMain.integration.test.ts; here only the wiring.
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const { spawn } = await import("node:child_process");
const spawnMock = vi.mocked(spawn);

class FakeChild extends EventEmitter {
    public readonly sent: unknown[] = [];
    public readonly stderr = null;

    public send(message: unknown): boolean {
        this.sent.push(message);
        return true;
    }

    public killed = false;

    public kill(): boolean {
        this.killed = true;
        return true;
    }
}

afterEach(() => {
    spawnMock.mockReset();
});

/** The crawl must run in a separate process (or it lands on the main loop again), and shutdown must kill that process. */
describe("fileWatcherModule", () => {
    function setup(): { container: Container; entries: LogEntry[]; child: FakeChild; logService: LogService } {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);
        const logService = new LogService();
        logService.setLevel("*", LogLevel.Trace);
        const entries: LogEntry[] = [];
        logService.addSink({ append: (entry) => entries.push(entry), dispose: () => undefined });
        const container = new Container()
            .bind(ILogServiceDIToken, () => logService)
            .bind(LifecycleServiceDIToken, () => new LifecycleService(new DialogService()))
            .use(fileWatcherModule);
        return { container, entries, child, logService };
    }

    it("a watch request goes to a separate process instead of starting a crawl here", () => {
        const { container, child } = setup();

        container
            .get(ITreeFileWatcherDIToken)
            .watchTree("/repo", { recursive: true, excludes: ["**/node_modules"] }, () => undefined);

        const [, , options] = spawnMock.mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }];
        expect(options.env.DIODE_FILE_WATCHER).toBe("1");
        expect(child.sent).toEqual([
            { t: "watch", id: 1, rootPath: "/repo", options: { recursive: true, excludes: ["**/node_modules"] } },
        ]);
    });

    it("the per-file watcher is chokidar in this process, its channel is labeled for Output", () => {
        const { container, logService } = setup();

        expect(container.get(IFileWatcherDIToken)).toBeInstanceOf(ChokidarFileWatcher);
        expect(logService.getRegisteredChannels()).toEqual([{ id: "files.watcher", label: "File Watcher" }]);
    });

    it("the watcher process channel is labeled for Output even without the per-file watcher", () => {
        const { container, logService } = setup();

        container.get(SubprocessTreeWatcherDIToken);

        expect(logService.getRegisteredChannels()).toEqual([{ id: "files.watcher", label: "File Watcher" }]);
    });

    it("both tokens yield the same object", () => {
        const { container } = setup();

        expect(container.get(ITreeFileWatcherDIToken)).toBe(container.get(SubprocessTreeWatcherDIToken));
    });

    it("shutdown stops the very process extensions use", async () => {
        const { container, child } = setup();
        container.get(ITreeFileWatcherDIToken).watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);
        expect(child.killed).toBe(false);

        await container.get(LifecycleServiceDIToken).shutdown("reload", () => {
            // The sync phase is over: the process is killed before the new window starts.
            expect(child.killed).toBe(true);
        });

        expect(child.killed).toBe(true);
    });

    it("watcher process diagnostics go to the files.watcher channel", () => {
        const { container, entries, child } = setup();
        container.get(ITreeFileWatcherDIToken).watchTree("/repo", { recursive: true, excludes: [] }, () => undefined);

        child.emit("message", { t: "log", level: "warn", message: "tree watcher error", args: [{ code: "ENOSPC" }] });

        const entry = entries.at(-1);
        expect(entry?.channel).toBe("files.watcher");
        expect(entry?.message).toContain("tree watcher error");
    });
});
