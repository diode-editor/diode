// Run: node --test scripts/ (npm run test:scripts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { stripRuntimeCode } from "./import-vscode-extensions.mjs";

const repoRoot = resolve(import.meta.dirname, "..");

/** Upstream `git-base` as it is cloned: `main` and the API command, next to the languages we keep. */
const gitBaseUpstream = () => ({
    name: "git-base",
    publisher: "vscode",
    activationEvents: ["*"],
    main: "./out/extension.js",
    browser: "./dist/browser/extension.js",
    icon: "resources/icons/git.png",
    scripts: { compile: "gulp compile-extension:git-base" },
    contributes: {
        commands: [{ command: "git-base.api.getRemoteSources", title: "%command.api.getRemoteSources%" }],
        menus: { commandPalette: [{ command: "git-base.api.getRemoteSources", when: "false" }] },
        languages: [{ id: "git-commit", filenames: ["COMMIT_EDITMSG"] }],
        grammars: [
            { language: "git-commit", scopeName: "text.git-commit", path: "./syntaxes/git-commit.tmLanguage.json" },
        ],
    },
});

test("stripRuntimeCode: a pack with main loses the fields that promise code and keeps its languages", () => {
    const manifest = gitBaseUpstream();
    const removed = stripRuntimeCode(manifest);
    assert.deepEqual(removed, ["main", "browser", "activationEvents", "contributes.commands", "contributes.menus"]);
    assert.deepEqual(manifest, {
        name: "git-base",
        publisher: "vscode",
        icon: "resources/icons/git.png",
        scripts: { compile: "gulp compile-extension:git-base" },
        contributes: {
            languages: [{ id: "git-commit", filenames: ["COMMIT_EDITMSG"] }],
            grammars: [
                { language: "git-commit", scopeName: "text.git-commit", path: "./syntaxes/git-commit.tmLanguage.json" },
            ],
        },
    });
});

test("stripRuntimeCode: a declarative pack is left untouched, even with activationEvents", () => {
    const manifest = {
        name: "json",
        activationEvents: ["onLanguage:json"],
        contributes: { languages: [{ id: "json" }], menus: { commandPalette: [] } },
    };
    const before = structuredClone(manifest);
    assert.deepEqual(stripRuntimeCode(manifest), []);
    assert.deepEqual(manifest, before);
});

test("stripRuntimeCode: a pack with main and no contributes does not crash", () => {
    const manifest = { name: "x", main: "./out/extension.js" };
    assert.deepEqual(stripRuntimeCode(manifest), ["main"]);
    assert.deepEqual(manifest, { name: "x" });
});

test("extensions/git-base/package.json is already stripped (the imported tree matches the script)", () => {
    const manifest = JSON.parse(readFileSync(resolve(repoRoot, "extensions/git-base/package.json"), "utf8"));
    assert.equal(stripRuntimeCode(manifest).length, 0);
    assert.ok(manifest.contributes.languages.some((l) => l.id === "git-commit"));
});
