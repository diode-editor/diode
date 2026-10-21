import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLIENT_CRASH_PATTERNS, until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    ensureEslintLibrary,
    ESLINT_FLAT_CONFIG,
    ESLINT_ID,
    type IInstalledEslint,
    installEslint,
    JS_LANGUAGE_SERVICE,
    linkEslintLibrary,
    LINT_JS,
} from "../../../../../TestUtils/eslintFixture.ts";
import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { WireMarker } from "../../../api/common/wireTypes.ts";

// The extension's server resolves the eslint library from the workspace node_modules;
// the fixture provides it via a symlink.

let installed: IInstalledEslint;
let eslintNodeModules: string;

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — stock vscode-eslint.vsix (JS lint, end-to-end)", () => {
    beforeAll(async () => {
        installed = await installEslint();
        expect(installed.registration.id).toBe(ESLINT_ID);
        eslintNodeModules = ensureEslintLibrary();
    }, 300_000);

    afterAll(() => {
        installed.dispose();
    });

    it(
        "activation without errors, no-extra-semi arrives and goes away after an unsaved edit",
        { timeout: 240_000 },
        async () => {
            const published: { resource: string; markers: readonly WireMarker[] }[] = [];
            const outputLines: { level: string; value: string }[] = [];
            const harness: IExtensionHarness = await createExtensionTestHarness({
                languageService: JS_LANGUAGE_SERVICE,
                activateEvents: [],
                diagnosticsSink: (_owner, resource, markers) => published.push({ resource, markers }),
                outputSink: {
                    append: (_channel, _label, level, value) => outputLines.push({ level, value }),
                    show: () => undefined,
                },
                extensions: [installed.registration],
            });
            try {
                linkEslintLibrary(harness.tmpDir, eslintNodeModules);
                harness.writeFile("eslint.config.mjs", ESLINT_FLAT_CONFIG);
                const lintPath = harness.writeFile("lint.js", LINT_JS);
                const lintUri = Uri.file(lintPath).toString();
                const markersFor = (uri: string): readonly WireMarker[] =>
                    published.filter((p) => p.resource === uri).at(-1)?.markers ?? [];

                harness.group.openFile(lintPath);
                await harness.host.activateByEvent("onStartupFinished");
                expect(harness.host.hasExtension(ESLINT_ID)).toBe(true);

                const extraSemi = await until("no-extra-semi diagnostic in lint.js", () => {
                    const hit = markersFor(lintUri).find((m) => (m.code ?? "") === "no-extra-semi");
                    return Promise.resolve(hit ?? null);
                });
                expect(extraSemi.range.start.line).toBe(0);
                expect(markersFor(lintUri).some((m) => (m.code ?? "") === "no-unused-vars")).toBe(true);

                // NO save to disk: eslint.run=onType re-lints the live buffer.
                harness.group
                    .getActiveEditor()
                    ?.applyExternalEdits([createTextEdit(createRange(0, 17, 0, 18), "")], "drop extra semi");
                await until("no-extra-semi gone after the edit", () =>
                    Promise.resolve(markersFor(lintUri).some((m) => (m.code ?? "") === "no-extra-semi") ? null : true),
                );
                expect(markersFor(lintUri).some((m) => (m.code ?? "") === "no-unused-vars")).toBe(true);

                const crashes = outputLines.filter((l) => CLIENT_CRASH_PATTERNS.test(l.value));
                expect(crashes).toEqual([]);
            } finally {
                await harness.dispose();
            }
        },
    );
});
