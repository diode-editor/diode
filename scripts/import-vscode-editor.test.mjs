import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { builtinManifest, rewriteImportExtensions, substituteImports } from "./import-vscode-editor.mjs";

const repoRoot = resolve(import.meta.dirname, "..");

test("rewriteImportExtensions: .js becomes .ts, an extensionless relative specifier gets .ts", () => {
    assert.deepEqual(
        rewriteImportExtensions([
            "import { Range } from '../core/range.js';",
            "import Decorator from './mergeDecorator';",
            "import * as interfaces from '../interfaces';",
            "import { x } from './already.ts';",
            "import * as vscode from 'vscode';",
        ]),
        [
            "import { Range } from '../core/range.ts';",
            "import Decorator from './mergeDecorator.ts';",
            "import * as interfaces from '../interfaces.ts';",
            "import { x } from './already.ts';",
            "import * as vscode from 'vscode';",
        ],
    );
});

test("substituteImports: the telemetry package becomes our null reporter, relative to the vendored file", () => {
    assert.deepEqual(
        substituteImports(
            [
                "import TelemetryReporter from '@vscode/extension-telemetry';",
                "import type TelemetryReporter from '@vscode/extension-telemetry';",
                "import * as vscode from 'vscode';",
                "import Decorator from './mergeDecorator.ts';",
            ],
            "extensions/merge-conflict/src/services.ts",
        ),
        [
            "import TelemetryReporter from '../telemetryReporter.ts';",
            "import type TelemetryReporter from '../telemetryReporter.ts';",
            "import * as vscode from 'vscode';",
            "import Decorator from './mergeDecorator.ts';",
        ],
    );
});

test("builtinManifest: main points at the compiled bundle, upstream's build fields are gone, contributions stay", () => {
    const manifest = builtinManifest({
        name: "merge-conflict",
        publisher: "vscode",
        icon: "media/icon.png",
        aiKey: "k",
        main: "./out/mergeConflictMain",
        browser: "./dist/browser/mergeConflictMain",
        scripts: { compile: "gulp" },
        dependencies: { "@vscode/extension-telemetry": "^0.9.8" },
        devDependencies: { "@types/node": "24.x" },
        contributes: { commands: [] },
    });
    assert.deepEqual(manifest, {
        name: "merge-conflict",
        publisher: "vscode",
        contributes: { commands: [] },
        type: "module",
        main: "./out/extension.cjs",
    });
});

test("extensions/merge-conflict/package.json is the builtin manifest (the imported tree matches the script)", () => {
    const manifest = JSON.parse(readFileSync(resolve(repoRoot, "extensions/merge-conflict/package.json"), "utf8"));
    assert.equal(manifest.main, "./out/extension.cjs");
    assert.equal(manifest.aiKey, undefined);
    assert.equal(manifest.browser, undefined);
});
