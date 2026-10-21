import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLIENT_CRASH_PATTERNS, PY_LANGUAGE_SERVICE, until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { type IInstalledRuff, installRuff, LINT_PY, RUFF_ID } from "../../../../../TestUtils/ruffFixture.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { WireMarker } from "../../../api/common/wireTypes.ts";

let installed: IInstalledRuff;

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — stock ruff.vsix (Python lint, end to end)", () => {
    beforeAll(async () => {
        installed = await installRuff();
        expect(installed.registration.id).toBe(RUFF_ID);
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it(
        "activation without errors, F401 arrives and goes away after an unsaved edit",
        { timeout: 240_000 },
        async () => {
            const published: { resource: string; markers: readonly WireMarker[] }[] = [];
            const outputLines: { level: string; value: string }[] = [];
            const harness: IExtensionHarness = await createExtensionTestHarness({
                languageService: PY_LANGUAGE_SERVICE,
                activateEvents: [],
                diagnosticsSink: (_owner, resource, markers) => published.push({ resource, markers }),
                outputSink: {
                    append: (_channel, _label, level, value) => outputLines.push({ level, value }),
                    show: () => undefined,
                },
                extensions: [installed.registration],
            });
            try {
                const lintPath = harness.writeFile("lint.py", LINT_PY);
                const lintUri = Uri.file(lintPath).toString();
                const markersFor = (uri: string): readonly WireMarker[] =>
                    published.filter((p) => p.resource === uri).at(-1)?.markers ?? [];

                harness.group.openFile(lintPath);
                // Lazy activation by exactly the event the vsix manifest declares.
                await harness.host.activateByEvent("onLanguage:python");
                expect(harness.host.hasExtension(RUFF_ID)).toBe(true);

                // Pull diagnostics from the REAL bundled `ruff server` serve as the readiness signal.
                const f401 = await until("F401 diagnostic in lint.py", () => {
                    const hit = markersFor(lintUri).find((m) => /F401|unused/.test(`${m.code ?? ""} ${m.message}`));
                    return Promise.resolve(hit ?? null);
                });
                // `import sys` is the first line of the file.
                expect(f401.range.start.line).toBe(0);

                // No save: the client must re-request pull diagnostics for the live buffer.
                harness.group
                    .getActiveEditor()
                    ?.applyExternalEdits([createTextEdit(createRange(0, 0, 1, 0), "")], "drop unused import");
                await until("F401 gone after the edit", () =>
                    Promise.resolve(
                        markersFor(lintUri).some((m) => /F401|unused/.test(`${m.code ?? ""} ${m.message}`))
                            ? null
                            : true,
                    ),
                );

                const crashes = outputLines.filter((l) => CLIENT_CRASH_PATTERNS.test(l.value));
                expect(crashes).toEqual([]);
            } finally {
                await harness.dispose();
            }
        },
    );
});
