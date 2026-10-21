import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Закрытие редактора не оставляет живых процессов, включая внука — сервер, поднятый
 * самим расширением. Это НЕ гейт группового kill'а: тест зелёный и без `detached`,
 * стоковый сервер закрывает tsserver сам по `deactivate`. Гейт — юнит
 * `extensionHost.orphans.test.ts` (фикстура сервер НЕ закрывает, как jdtls) —
 * не удаляй его как дубль этого.
 */

const require_ = createRequire(import.meta.url);
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": SERVER_CLI,
    "diode.lsp.typescript.tsserverPath": TSSERVER_JS,
};

const MAIN_TS = 'export function greet(name: string): string {\n    return "hi " + name;\n}\n';

/** Пустой список — детей нет: pgrep выходит кодом 1. */
function childrenOf(pid: number): number[] {
    try {
        return execFileSync("pgrep", ["-P", String(pid)], { encoding: "utf-8" })
            .split("\n")
            .map((line) => Number.parseInt(line.trim(), 10))
            .filter((n) => Number.isInteger(n));
    } catch {
        return [];
    }
}

/** Всё поддерево процесса, сам процесс включительно. */
function processTree(pid: number): number[] {
    const tree = [pid];
    for (const child of childrenOf(pid)) tree.push(...processTree(child));
    return tree;
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

// pgrep и сигнал 0 — posix; на Windows дерево процессов смотрится иначе.
describe.skipIf(process.platform === "win32" || process.platform === "darwin")(
    "SEA binary — выход редактора уносит языковые серверы расширений",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("tsserver, поднятый расширением, не остаётся сиротой", { timeout: 240_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: {
                    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
                    "main.ts": MAIN_TS,
                },
                settings: LSP_SETTINGS,
                open: ["main.ts"],
            });
            await session.waitForNode("EditorElement");

            const editorPid = session.pid;
            expect(editorPid).toBeDefined();

            // Ждём именно ВНУКА: субпроцесс расширений — прямой ребёнок, и «любые потомки»
            // нашлись бы без поднятого сервера.
            const tree = await waitUntil(
                () => Promise.resolve(processTree(editorPid as number)),
                (pids) => pids.length >= 3,
                { describe: "редактор + субпроцесс расширений + языковой сервер", timeoutMs: 120_000, intervalMs: 500 },
            );

            await session.dispose();

            // Дерево уходит не мгновенно: вежливое прощание идёт по цепочке.
            await waitUntil(
                () => Promise.resolve(tree.filter(isAlive)),
                (alive) => alive.length === 0,
                { describe: "всё дерево процессов вышло", timeoutMs: 30_000, intervalMs: 250 },
            );
        });
    },
);
