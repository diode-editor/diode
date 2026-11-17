import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Stock Angular.ng-template forks `{ module: "<extension>/server" }`, a directory. Under SEA it crashed with
// ERR_UNSUPPORTED_DIR_IMPORT five times and was never restarted. Runs a child process with tsx: its argv
// arithmetic matches SEA. tsx itself resolves `index.js` and a missing `.js` extension, so only the
// `package.json` `main` cases fail here without the fix; under SEA every case below needs it.

const ENTRY = fileURLToPath(new URL("./runAsNode.testEntry.ts", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

function run(script: string): { status: number | null; stdout: string; stderr: string } {
    return spawnSync(process.execPath, ["--import", "tsx", ENTRY, script, "tail"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: 30_000,
    });
}

const PRINT = 'console.log("ran", JSON.stringify(process.argv.slice(2)));\n';

describe("runAsNode — main entry resolution like `node <path>`", () => {
    let root = "";
    beforeEach(() => {
        root = mkdtempSync(path.join(tmpdir(), "diode-run-as-node-"));
    });
    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    it("a directory runs its package.json main, and argv keeps the given path", () => {
        const dir = path.join(root, "server");
        mkdirSync(path.join(dir, "out"), { recursive: true });
        writeFileSync(path.join(dir, "package.json"), JSON.stringify({ main: "./out/main.js" }));
        writeFileSync(path.join(dir, "out", "main.js"), PRINT);
        const result = run(dir);
        expect(result.stderr).not.toContain("ERR_UNSUPPORTED_DIR_IMPORT");
        expect(result.stdout.trim()).toBe('ran ["tail"]');
        expect(result.status).toBe(0);
    });

    it("a directory without package.json runs index.js", () => {
        const dir = path.join(root, "server");
        mkdirSync(dir);
        writeFileSync(path.join(dir, "index.js"), PRINT);
        expect(run(dir).stdout.trim()).toBe('ran ["tail"]');
    });

    it("a path without an extension finds the .js file", () => {
        writeFileSync(path.join(root, "server.js"), PRINT);
        expect(run(path.join(root, "server")).stdout.trim()).toBe('ran ["tail"]');
    });

    it("an ESM main of a directory package runs as ESM", () => {
        const dir = path.join(root, "server");
        mkdirSync(dir);
        writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: "module", main: "main.js" }));
        writeFileSync(path.join(dir, "main.js"), `const meta = import.meta.url;\n${PRINT}`);
        expect(run(dir).stdout.trim()).toBe('ran ["tail"]');
    });

    it("a missing script exits 1 with the loader's error", () => {
        const result = run(path.join(root, "missing.js"));
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("missing.js");
    });
});
