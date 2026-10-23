// Run: node --test scripts/ (npm run test:scripts).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { assertEntryPointHasSource } from "./build-extensions.mjs";

const repoRoot = resolve(import.meta.dirname, "..");

test("assertEntryPointHasSource: a manifest with main and no main.ts is refused with the fix in the message", () => {
    assert.throws(
        () => assertEntryPointHasSource("git-base", { main: "./out/extension.js" }, false),
        /git-base: the manifest declares main "\.\/out\/extension\.js" but there is no main\.ts[\s\S]*import-vscode-extensions\.mjs/,
    );
});

test("assertEntryPointHasSource: a compiled builtin and a declarative pack pass", () => {
    assertEntryPointHasSource("git", { main: "./out/extension.cjs" }, true);
    assertEntryPointHasSource("json", { contributes: { languages: [] } }, false);
});

test("every builtin in extensions/ that declares main has a main.ts to compile", () => {
    const builtinDir = resolve(repoRoot, "extensions");
    for (const entry of readdirSync(builtinDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = join(builtinDir, entry.name);
        const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        assertEntryPointHasSource(entry.name, manifest, existsSync(join(dir, "main.ts")));
    }
});
