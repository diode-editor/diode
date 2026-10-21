import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Closing the editor leaves no live processes, including the grandchild — the server started
 * by the extension itself. This is NOT the gate for the group kill: the test is green even without
 * `detached`, since the stock server shuts tsserver down itself on `deactivate`. The gate is the unit
 * test `extensionHost.orphans.test.ts` (its fixture does NOT close the server, like jdtls) —
 * don't delete it as a duplicate of this one.
 */

const require_ = createRequire(import.meta.url);
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

const LSP_SETTINGS = {
    "diode.lsp.typescript.serverPath": SERVER_CLI,
    "diode.lsp.typescript.tsserverPath": TSSERVER_JS,
};

const MAIN_TS = 'export function greet(name: string): string {\n    return "hi " + name;\n}\n';

/** Empty list when there are no children: pgrep exits with code 1. */
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

/** The whole process subtree, including the process itself. */
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

// pgrep and signal 0 are POSIX; on Windows the process tree is inspected differently.
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

            // Wait specifically for the GRANDCHILD: the extension host subprocess is a direct child,
            // so "any descendants" would be found without the server running.
            const tree = await waitUntil(
                () => Promise.resolve(processTree(editorPid as number)),
                (pids) => pids.length >= 3,
                { describe: "редактор + субпроцесс расширений + языковой сервер", timeoutMs: 120_000, intervalMs: 500 },
            );

            await session.dispose();

            // The tree does not exit instantly: the graceful shutdown propagates down the chain.
            await waitUntil(
                () => Promise.resolve(tree.filter(isAlive)),
                (alive) => alive.length === 0,
                { describe: "всё дерево процессов вышло", timeoutMs: 30_000, intervalMs: 250 },
            );
        });
    },
);
