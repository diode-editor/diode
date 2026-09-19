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
 * Сквозной прогон через настоящую границу процессов: хост-прокси ↔ node IPC ↔
 * watcher-процесс с живым chokidar. Юниты по обе стороны говорят с фейками, и
 * ровно из-за этого не видят целого класса поломок (сообщение не переживает
 * JSON, ребёнок не доходит до точки входа, канал не подписан) — этот сьют и
 * закрывает середину: правка файла на диске обязана доехать до колбэка в
 * процессе редактора.
 *
 * Ребёнок поднимается через тот же `SubprocessTreeWatcher`, только `spawnProcess`
 * указывает на тестовый вход под tsx: боевой `selfSpawnArgs()` из-под vitest
 * запустил бы не нас.
 */

const ENTRY = fileURLToPath(new URL("./treeWatcherMain.testEntry.ts", import.meta.url));
const TIMEOUT_MS = 30_000;

/** Ребёнок-вход под tsx, адаптированный под шов хоста. */
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

            // Пишем в цикле: ребёнку нужно время подняться и досканировать
            // дерево, а всё, что он застал при старте, `ignoreInitial` съедает.
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
            // Калька с `extensionHost.fork.test.ts`: флаг роли наследуется через
            // spawn, и не снятый здесь увёл бы любой запущенный рядом процесс
            // (под SEA это наш же бинарь) в watcher-ветку вместо его работы.
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
            // Здесь нужен сам ChildProcess, а не шов хоста: закрытие канала без
            // сигнала — это то, что случается с ребёнком, когда редактор умирает.
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
