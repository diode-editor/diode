import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLIENT_CRASH_PATTERNS, until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import {
    createMavenProject,
    type IInstalledJava,
    installJava,
    JAVA_ACTIVATION_EVENT,
    JAVA_ID,
    JAVA_LANGUAGE_SERVICE,
} from "../../../../../TestUtils/javaFixture.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { WireMarker } from "../../../api/common/wireTypes.ts";

// A cold jdt_ws takes ~16 s to the first diagnostic (two JVMs): the generous timeouts are
// the working value, not a margin.

// `| undefined`: if `beforeAll` fails, an unconditional `installed.dispose()` in afterAll
// would mask the real cause with "Cannot read properties of undefined".
let installed: IInstalledJava | undefined;

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — стоковый redhat.java (jdt.ls, сквозняк)", () => {
    beforeAll(async () => {
        installed = await installJava();
        expect(installed.registration.id).toBe(JAVA_ID);
    }, 300_000);

    afterAll(() => {
        installed?.dispose();
    });

    it(
        "активация по workspaceContains:, диагностика приезжает и уходит после несохранённой правки",
        { timeout: 300_000 },
        async () => {
            const published: { resource: string; markers: readonly WireMarker[] }[] = [];
            const outputLines: { level: string; value: string }[] = [];
            // The workspace folder must differ from the `tmpDir` holding the extension storage
            // (see javaFixture.createMavenProject for why).
            const project = createMavenProject();
            const harness: IExtensionHarness = await createExtensionTestHarness({
                languageService: JAVA_LANGUAGE_SERVICE,
                workspaceFolders: [project.root],
                // Empty: we activate by hand. `workspaceContains:` reads the real tree,
                // so the order "project on disk, then event" matters here.
                activateEvents: [],
                diagnosticsSink: (_owner, resource, markers) => published.push({ resource, markers }),
                outputSink: {
                    append: (_channel, _label, level, value) => outputLines.push({ level, value }),
                    show: () => undefined,
                },
                extensions: [installed!.registration],
            });
            try {
                const appPath = project.appPath;
                const appUri = Uri.file(appPath).toString();
                const markersFor = (uri: string): readonly WireMarker[] =>
                    published.filter((p) => p.resource === uri).at(-1)?.markers ?? [];

                harness.group.openFile(appPath);
                // Lazy activation by exactly the event the vsix manifest declares:
                // redhat.java has neither `*` nor `onLanguage:java`.
                await harness.host.activateByEvent(JAVA_ACTIVATION_EVENT);
                expect(harness.host.hasExtension(JAVA_ID)).toBe(true);

                // A diagnostic from the REAL jdt.ls is the readiness signal: it arrives
                // only after m2e has imported and built the project.
                const mismatch = await until(
                    "диагностика Type mismatch в App.java",
                    () => {
                        const hit = markersFor(appUri).find((m) =>
                            m.message.includes("cannot convert from String to int"),
                        );
                        return Promise.resolve(hit ?? null);
                    },
                    280_000,
                );
                // `int broken = message;` is the fixture's tenth line (0-based 9).
                expect(mismatch.range.start.line).toBe(9);

                // No save: the server must re-check the live buffer, not the file.
                harness.group
                    .getActiveEditor()
                    ?.applyExternalEdits([createTextEdit(createRange(9, 8, 9, 11), "String")], "fix type");
                await until(
                    "Type mismatch ушла после правки",
                    () =>
                        Promise.resolve(
                            markersFor(appUri).some((m) => m.message.includes("cannot convert from String to int"))
                                ? null
                                : true,
                        ),
                    280_000,
                );

                const crashes = outputLines.filter((l) => CLIENT_CRASH_PATTERNS.test(l.value));
                expect(crashes).toEqual([]);
            } finally {
                await harness.dispose();
                project.dispose();
            }
        },
    );
});
