import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { LogEntry } from "../../log/common/iLogService.ts";
import { LogLevel } from "../../log/common/logLevel.ts";
import { LogService } from "../../log/common/logService.ts";
import type { ITreeFileChange } from "../common/iTreeFileWatcher.ts";

import type { IWatcherProcess } from "./subprocessTreeWatcher.ts";
import { SubprocessTreeWatcher } from "./subprocessTreeWatcher.ts";

/**
 * Unit tests on both sides talk to fakes and don't see breakage of the boundary itself
 * (a message doesn't survive JSON, the child never reaches the entry point). `spawnProcess`
 * is a test entry under tsx: the production `selfSpawnArgs()` under vitest would launch something else.
 */

const ENTRY = fileURLToPath(new URL("./treeWatcherMain.testEntry.ts", import.meta.url));
const TIMEOUT_MS = 30_000;

function spawnTestEntry(): IWatcherProcess {
    const child = spawn(process.execPath, ["--import", "tsx", ENTRY], {
        stdio: ["ignore", "ignore", "inherit", "ipc"],
        env: { ...process.env, DIODE_FILE_WATCHER: "1" },
    });
    return {
        send: (message) => {
            child.send(message);
        },
        onMessage: (listener) => {
            child.on("message", listener);
        },
        onExit: (listener) => {
            child.once("exit", listener);
        },
        onError: (listener) => {
            child.on("error", listener);
        },
        kill: () => {
            child.kill("SIGKILL");
        },
    };
}

async function until(predicate: () => boolean, onTick?: () => void): Promise<void> {
    const deadline = Date.now() + TIMEOUT_MS;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error("timed out waiting for the watcher process");
        onTick?.();
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

describe("watcher-процесс — сквозной прогон", () => {
    const watchers: SubprocessTreeWatcher[] = [];
    const roots: string[] = [];

    afterEach(() => {
        for (const watcher of watchers) watcher.dispose();
        watchers.length = 0;
        for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
        roots.length = 0;
    });

    function setup(): { watcher: SubprocessTreeWatcher; root: string; entries: LogEntry[] } {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "diode-watcher-proc-"));
        roots.push(root);
        const logService = new LogService();
        logService.setLevel("*", LogLevel.Trace);
        const entries: LogEntry[] = [];
        logService.addSink({ append: (entry) => entries.push(entry), dispose: () => undefined });
        const watcher = new SubprocessTreeWatcher({
            spawnProcess: spawnTestEntry,
            logger: logService.createLogger("files.watcher"),
        });
        watchers.push(watcher);
        return { watcher, root, entries };
    }

    it(
        "правка файла на диске доезжает до колбэка в процессе редактора",
        async () => {
            const { watcher, root } = setup();
            const seen: ITreeFileChange[] = [];
            watcher.watchTree(root, { recursive: true, excludes: [] }, (changes) => seen.push(...changes));

            // Write in a loop: the child needs time to start and finish scanning
            // the tree, and `ignoreInitial` swallows everything it finds at startup.
            let n = 0;
            await until(
                () => seen.some((change) => path.basename(change.path).startsWith("bump-")),
                () => {
                    fs.writeFileSync(path.join(root, `bump-${String(n++)}.txt`), "x");
                },
            );

            expect(seen.at(-1)?.type).toBe("created");
        },
        TIMEOUT_MS,
    );

    it(
        "события под excludes не приезжают — отказ обходить доезжает до chokidar",
        async () => {
            const { watcher, root } = setup();
            fs.mkdirSync(path.join(root, "node_modules"));
            fs.mkdirSync(path.join(root, "src"));
            const seen: ITreeFileChange[] = [];
            watcher.watchTree(root, { recursive: true, excludes: ["**/node_modules"] }, (changes) =>
                seen.push(...changes),
            );

            let n = 0;
            await until(
                () => seen.some((change) => change.path.includes(`${path.sep}src${path.sep}`)),
                () => {
                    const name = `bump-${String(n++)}.txt`;
                    fs.writeFileSync(path.join(root, "node_modules", name), "x");
                    fs.writeFileSync(path.join(root, "src", name), "x");
                },
            );

            expect(seen.some((change) => change.path.includes("node_modules"))).toBe(false);
        },
        TIMEOUT_MS,
    );

    it(
        "диагностика watcher-процесса приезжает в канал files.watcher хоста",
        async () => {
            const { watcher, root, entries } = setup();
            watcher.watchTree(root, { recursive: true, excludes: [] }, () => undefined);

            await until(() => entries.some((entry) => entry.message.includes("file watcher process started")));

            expect(entries.find((entry) => entry.message.includes("file watcher process started"))?.channel).toBe(
                "files.watcher",
            );
        },
        TIMEOUT_MS,
    );

    it(
        "роль не протекает дальше: внутри процесса DIODE_FILE_WATCHER снят, режим — node",
        async () => {
            // Mirrors `extensionHost.fork.test.ts`: the role flag is inherited through
            // spawn, and if not cleared here it would send any process launched alongside
            // (under SEA that's our own binary) down the watcher branch instead of its own work.
            const { watcher, root, entries } = setup();
            watcher.watchTree(root, { recursive: true, excludes: [] }, () => undefined);

            await until(() => entries.some((entry) => entry.message.includes("test-entry env")));

            const report = entries.find((entry) => entry.message.includes("test-entry env"))?.args.at(0);
            expect(report).toEqual({ fileWatcher: null, runAsNode: "1" });
        },
        TIMEOUT_MS,
    );

    it(
        "закрытый IPC-канал уводит watcher-процесс в exit — сироты с подписками не остаётся",
        async () => {
            // This needs the ChildProcess itself, not the host seam: the channel closing without
            // a signal is what happens to the child when the editor dies.
            const child = spawn(process.execPath, ["--import", "tsx", ENTRY], {
                stdio: ["ignore", "ignore", "inherit", "ipc"],
                env: { ...process.env, DIODE_FILE_WATCHER: "1" },
            });
            let started = false;
            let exited = false;
            child.on("message", () => {
                started = true;
            });
            child.once("exit", () => {
                exited = true;
            });

            await until(() => started);
            child.disconnect();

            await until(() => exited);
            expect(exited).toBe(true);
        },
        TIMEOUT_MS,
    );
});
