import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Закрытие редактора не оставляет живых процессов: ни субпроцесса расширений,
 * ни языкового сервера, которого поднял не редактор, а само расширение (внук).
 * Тест смотрит не на кадр, а на дерево процессов — здесь только оно и видно.
 *
 * **Что он НЕ закрывает.** Это не гейт группового kill'а (`detached` +
 * `process.kill(-pid)`): проверено — тест зелёный и с выключенным `detached`,
 * потому что стоковый `typescript-language-server` корректно закрывает tsserver
 * сам, по `deactivate`. Гейт группового сигнала — юнит
 * `extensionHost.orphans.test.ts`: там фикстура сервер намеренно НЕ закрывает,
 * то есть воспроизводит расширение, которое упало или не успело попрощаться
 * (как jdtls, оставлявший сироты и 56 МБ CDS-архива за прогон). Не удаляй тот
 * юнит, решив, что этот его дублирует — он проверяет другое.
 *
 * Ценность этого теста — сквозной путь в настоящем SEA-бинаре: прощание идёт по
 * всей цепочке, а не в харнессе.
 */

const require_ = createRequire(import.meta.url);
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": SERVER_CLI,
    "diode.lsp.typescript.tsserverPath": TSSERVER_JS,
};

const MAIN_TS = 'export function greet(name: string): string {\n    return "hi " + name;\n}\n';

/** Прямые дети процесса. Пустой список — детей нет (pgrep выходит кодом 1). */
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

            // Ждём именно ВНУКА: субпроцесс расширений — прямой ребёнок, а
            // языковой сервер живёт на уровень глубже. Если ждать «любых
            // потомков», тест пройдёт и без поднятого сервера.
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
