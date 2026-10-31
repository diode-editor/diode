import assert from "node:assert/strict";
import { createWriteStream, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import yazl from "yazl";

import { loadSurface } from "./ext-survey-analyze.mjs";
import { analyzeVsix, hasCode, sortSurvey, uniqueIds } from "./ext-survey.mjs";

async function makeVsix(files) {
    const dir = mkdtempSync(join(tmpdir(), "ext-survey-test-"));
    const path = join(dir, "x.vsix");
    const zip = new yazl.ZipFile();
    for (const [name, content] of Object.entries(files)) zip.addBuffer(Buffer.from(content), name);
    zip.end();
    await new Promise((done, fail) => {
        zip.outputStream.pipe(createWriteStream(path)).on("close", done).on("error", fail);
    });
    return { path, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

const surface = loadSurface();

test("analyzeVsix reads the manifest and every script of the extension, node_modules included", async () => {
    const vsix = await makeVsix({
        "extension/package.json": JSON.stringify({ main: "./out/main.js", contributes: { views: {}, commands: [] }, activationEvents: ["onView:a", "*"] }),
        "extension/out/main.js": `const v = require("vscode"); v.window.createTreeView("a", {});`,
        "extension/node_modules/client/lib.js": `const c = require("vscode"); c.languages.createDiagnosticCollection("a");`,
        "extension/media/readme.txt": `require("vscode").window.showErrorMessage("not code")`,
        "outside.js": `require("vscode").window.showInputBox()`,
    });
    try {
        const result = await analyzeVsix(vsix.path, surface);
        assert.deepEqual(result.members, ["languages.createDiagnosticCollection", "window.createTreeView"]);
        assert.equal(result.apiFound, true);
        assert.equal(result.hasCode, true);
        assert.deepEqual(result.contributes, ["commands", "views"]);
        assert.deepEqual(result.activationEvents, ["*", "onView:a"]);
    } finally {
        vsix.dispose();
    }
});

test("a bundle hiding the API is apiFound: false, not an error", async () => {
    const vsix = await makeVsix({ "extension/package.json": JSON.stringify({ main: "m.js" }), "extension/m.js": "module.exports = 1" });
    try {
        const result = await analyzeVsix(vsix.path, surface);
        assert.equal(result.apiFound, false);
        assert.deepEqual(result.members, []);
    } finally {
        vsix.dispose();
    }
});

test("a bundle too deep for the default stack is analyzed on a deep one", async () => {
    const deep = `const v = require("vscode"); v.window.showInputBox(); x = ${"(".repeat(20000)}1${")".repeat(20000)};`;
    const vsix = await makeVsix({ "extension/package.json": JSON.stringify({ main: "m.js" }), "extension/m.js": deep });
    try {
        const result = await analyzeVsix(vsix.path, surface);
        assert.equal(result.unparsedFiles, 0);
        assert.deepEqual(result.members, ["window.showInputBox"]);
    } finally {
        vsix.dispose();
    }
});

test("a vsix without a manifest is an error", async () => {
    const vsix = await makeVsix({ "extension/m.js": "1" });
    try {
        await assert.rejects(analyzeVsix(vsix.path, surface), /no extension\/package\.json/);
    } finally {
        vsix.dispose();
    }
});

test("a theme or a pack has no code", () => {
    assert.equal(hasCode({ contributes: { themes: [] } }), false);
    assert.equal(hasCode({ extensionPack: ["a.b"] }), false);
    assert.equal(hasCode({ main: "./a.js" }), true);
    assert.equal(hasCode({ browser: "./a.js" }), true);
});

test("the search lists one row per platform build: ids are unique, order kept", () => {
    assert.deepEqual(
        uniqueIds([
            { namespace: "a", name: "x" },
            { namespace: "b", name: "y" },
            { namespace: "a", name: "x" },
        ]),
        [
            { namespace: "a", name: "x" },
            { namespace: "b", name: "y" },
        ],
    );
});

test("the survey is ordered by downloads, then by id", () => {
    const sorted = sortSurvey([
        { id: "b", downloads: 1 },
        { id: "a", downloads: 1 },
        { id: "c", downloads: 5 },
    ]);
    assert.deepEqual(
        sorted.map((e) => e.id),
        ["c", "a", "b"],
    );
});
