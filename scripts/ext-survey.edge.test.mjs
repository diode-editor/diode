import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import yazl from "yazl";

import { loadSurface } from "./ext-survey-analyze.mjs";
import { analyzeVsix, uniqueIds } from "./ext-survey.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("ids differing only in case are one extension: Open VSX resolves both to the same record", () => {
    const rows = uniqueIds([
        { namespace: "golang", name: "Go" },
        { namespace: "golang", name: "go" },
    ]);
    assert.equal(rows.length, 1);
});

test("the committed survey counts every extension once", () => {
    const survey = JSON.parse(readFileSync(join(repoRoot, "docs", "extensions", "survey.json"), "utf8"));
    const seen = new Set();
    const duplicates = [];
    for (const { id } of survey.extensions) {
        if (seen.has(id.toLowerCase())) duplicates.push(id);
        seen.add(id.toLowerCase());
    }
    assert.deepEqual(duplicates, []);
});

test("a malformed manifest fails that vsix instead of killing the whole survey", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ext-survey-edge-"));
    const path = join(dir, "x.vsix");
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from("{"), "extension/package.json");
    zip.addBuffer(Buffer.from(`require("vscode").window.showInputBox();`), "extension/m.js");
    zip.end();
    await new Promise((done, fail) => {
        zip.outputStream.pipe(createWriteStream(path)).on("close", done).on("error", fail);
    });
    try {
        await assert.rejects(analyzeVsix(path, loadSurface()));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("--top that is not a number is refused at once, without walking the registry", () => {
    const dir = mkdtempSync(join(tmpdir(), "ext-survey-edge-"));
    const out = join(dir, "out.json");
    try {
        const run = spawnSync(process.execPath, [join(repoRoot, "scripts", "ext-survey.mjs"), "--top", "abc", "--cache", join(dir, "cache"), "--out", out], { encoding: "utf8", timeout: 15_000 });
        assert.equal(run.signal, null, "still running after 15 s");
        assert.notEqual(run.status, 0);
        assert.equal(existsSync(out), false);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
