import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Without `-e` support, stock eslint under SEA silently linted no files (ERR_MODULE_NOT_FOUND
// '<workspace>/-e'). Runs a child process with tsx: its argv arithmetic matches SEA.

const ENTRY = fileURLToPath(new URL("./runAsNode.testEntry.ts", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

function runEval(args: readonly string[]): string {
    return execFileSync(process.execPath, ["--import", "tsx", ENTRY, ...args], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 30_000,
    });
}

describe("runAsNode — eval-режим (-e)", () => {
    it("код исполняется CJS-семантикой node: require доступен, argv без слота скрипта", () => {
        const out = runEval(["-e", "console.log(typeof require, JSON.stringify(process.argv.slice(1)))", "tail"]);
        expect(out.trim()).toBe('function ["tail"]');
    });

    it("require из -e резолвит модули от cwd — контракт resolve-скрипта линтера", () => {
        const out = runEval(["-e", 'console.log(require.resolve("tsx"))']);
        expect(out).toContain("node_modules");
    });

    it("-e без аргумента — exit 9, как invalid argument у node", () => {
        const result = spawnSync(process.execPath, ["--import", "tsx", ENTRY, "-e"], {
            cwd: REPO_ROOT,
            encoding: "utf8",
            timeout: 30_000,
        });
        expect(result.status).toBe(9);
        expect(result.stderr).toContain("-e requires an argument");
    });
});
