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

describe("runAsNode — eval mode (-e)", () => {
    it("code runs with node CJS semantics: require is available, argv has no script slot", () => {
        const out = runEval(["-e", "console.log(typeof require, JSON.stringify(process.argv.slice(1)))", "tail"]);
        expect(out.trim()).toBe('function ["tail"]');
    });

    it("require from -e resolves modules from cwd — the linter resolve script's contract", () => {
        const out = runEval(["-e", 'console.log(require.resolve("tsx"))']);
        expect(out).toContain("node_modules");
    });

    it("-e without an argument — exit 9, like node's invalid argument", () => {
        const result = spawnSync(process.execPath, ["--import", "tsx", ENTRY, "-e"], {
            cwd: REPO_ROOT,
            encoding: "utf8",
            timeout: 30_000,
        });
        expect(result.status).toBe(9);
        expect(result.stderr).toContain("-e requires an argument");
    });
});
