import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { manifestWithDefaults } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    extensionFixture,
    type IExtensionHarness,
    provideDefinitions,
    provideFoldingRegions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import type { WireMarker } from "../../../api/common/wireTypes.ts";

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

// Edits are NOT saved to disk: the server must see the live buffer (didOpen/didChange), not the file.

const require_ = createRequire(import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../../../../..", import.meta.url));
const CLIENT_BUNDLE = path.join(REPO_ROOT, "extensions/diode-lsp-typescript/out/extension.cjs");
const SERVER_CLI = require_.resolve("typescript-language-server/lib/cli.mjs");
const TSSERVER_JS = require_.resolve("typescript/lib/tsserver.js");

const TS_LANGUAGE_SERVICE: ILanguageService = {
    ...NULL_LANGUAGE_SERVICE,
    getLanguageIdForResource: (filePath) =>
        filePath.endsWith(".ts") ? "typescript" : filePath.endsWith(".md") ? "markdown" : undefined,
    getLanguageDisplayName: () => undefined,
};

const DEFS_TS = 'export function greet(name: string): string {\n    return "hi " + name;\n}\n';
const MAIN_TS = 'import { greet } from "./defs";\n\nconst reply: number = greet("world");\n\nexport { reply };\n';

function lspClientRegistration(): IExtensionRegistration {
    return {
        id: "diode.diode-lsp-typescript",
        manifest: manifestWithDefaults(
            { name: "diode-lsp-typescript", publisher: "diode", version: "0.1.0" },
            {
                "diode.lsp.typescript.enabled": true,
                "diode.lsp.typescript.serverPath": "",
                "diode.lsp.typescript.tsserverPath": "",
            },
        ),
        mainPath: CLIENT_BUNDLE,
        activationEvents: ["onLanguage:typescript"],
    };
}

/** Polling with a deadline: the server indexes the project for seconds, sleeps won't do. */
async function until<T>(what: string, probe: () => Promise<T | null>, timeoutMs = 60_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const result = await probe();
        if (result !== null) return result;
        if (Date.now() > deadline) throw new Error(`until(${what}) timed out after ${String(timeoutMs)}ms`);
        await settle(500);
    }
}

describe("ExtensionHost — stock typescript-language-server (end-to-end)", () => {
    beforeAll(async () => {
        const { buildExtensions } = (await import(
            new URL("../../../../../../scripts/build-extensions.mjs", import.meta.url).href
        )) as { buildExtensions: (options: { repoRoot: string }) => Promise<unknown> };
        await buildExtensions({ repoRoot: REPO_ROOT });
    }, 120_000);

    it(
        "a mixed workspace does not poison the server: markdown is not synced, the channel has no errors",
        { timeout: 180_000 },
        async () => {
            // Regression: the subprocess is already alive, the active file at spawn is markdown, ts opens later.
            // The server got didOpen for markdown and empty meta wrappers and its handlers crashed; the errors
            // show only in the client's output channel.
            const published: { resource: string; markers: readonly WireMarker[] }[] = [];
            const outputLines: { level: string; value: string }[] = [];
            const harness: IExtensionHarness = await createExtensionTestHarness({
                languageService: TS_LANGUAGE_SERVICE,
                activateEvents: ["*"], // noop activates immediately, so the subprocess is alive before any file opens
                configuration: {
                    diode: { lsp: { typescript: { serverPath: SERVER_CLI, tsserverPath: TSSERVER_JS } } },
                },
                diagnosticsSink: (_owner, resource, markers) => published.push({ resource, markers }),
                outputSink: {
                    append: (_channel, _label, level, value) => outputLines.push({ level, value }),
                    show: () => undefined,
                },
                extensions: [
                    extensionFixture("test.noop", "noopExtension.cjs"),
                    { ...lspClientRegistration(), activationEvents: ["onLanguage:typescript"] },
                ],
            });
            try {
                harness.writeFile("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true } }));
                const readmePath = harness.writeFile("README.md", "# Project\n\nDescription.\n");
                const mainPath = harness.writeFile("main.ts", MAIN_TS);
                harness.writeFile("defs.ts", DEFS_TS);
                const mainUri = Uri.file(mainPath).toString();

                // markdown opened while the subprocess is alive, before the client activates,
                // so it lands in workspace.textDocuments.
                harness.group.openFile(readmePath);
                await settle();

                harness.group.openFile(mainPath);
                await harness.host.activateByEvent("onLanguage:typescript");

                await until("diagnostic on main.ts", () => {
                    const hit = published.some(
                        (p) => p.resource === mainUri && p.markers.some((m) => m.message.includes("not assignable")),
                    );
                    return Promise.resolve(hit ? true : null);
                });

                harness.group.openFile(readmePath);
                await settle();
                harness.group.openFile(mainPath);
                await settle(1000);

                const errors = outputLines.filter((l) =>
                    /Cannot open document|Unexpected resource|already open|failed with message/i.test(l.value),
                );
                expect(errors).toEqual([]);
            } finally {
                await harness.dispose();
            }
        },
    );

    it("diagnostics and go-to-definition over changing (unsaved) code", { timeout: 180_000 }, async () => {
        const published: { resource: string; markers: readonly WireMarker[] }[] = [];
        const progressEvents: { kind: string; handle: number; title?: string }[] = [];
        const outputLines: { channel: string; label: string; level: string; value: string }[] = [];
        const harness: IExtensionHarness = await createExtensionTestHarness({
            languageService: TS_LANGUAGE_SERVICE,
            activateEvents: [],
            configuration: {
                diode: { lsp: { typescript: { serverPath: SERVER_CLI, tsserverPath: TSSERVER_JS } } },
            },
            diagnosticsSink: (_owner, resource, markers) => published.push({ resource, markers }),
            progressSink: {
                start: (handle, title) => progressEvents.push({ kind: "start", handle, title }),
                report: (handle) => progressEvents.push({ kind: "report", handle }),
                end: (handle) => progressEvents.push({ kind: "end", handle }),
            },
            outputSink: {
                append: (channel, label, level, value) => outputLines.push({ channel, label, level, value }),
                show: () => undefined,
            },
            extensions: [lspClientRegistration()],
        });
        try {
            harness.writeFile("tsconfig.json", JSON.stringify({ compilerOptions: { strict: true } }));
            const defsPath = harness.writeFile("defs.ts", DEFS_TS);
            const mainPath = harness.writeFile("main.ts", MAIN_TS);
            const mainUri = Uri.file(mainPath).toString();
            const defsUri = Uri.file(defsPath).toString();
            const markersFor = (uri: string): readonly WireMarker[] =>
                published.filter((p) => p.resource === uri).at(-1)?.markers ?? [];

            harness.group.openFile(mainPath);
            await harness.host.activateByEvent("onLanguage:typescript");

            const startEvent = progressEvents.find((e) => e.kind === "start");
            expect(startEvent?.title).toContain("TypeScript (Diode)");
            expect(startEvent?.title).toContain("starting language server");
            await until("startup progress ended (end)", () => {
                const done = progressEvents.some((e) => e.kind === "end" && e.handle === startEvent?.handle);
                return Promise.resolve(done ? true : null);
            });

            const started = await until("server start line in the output channel", () => {
                const line = outputLines.find((l) => l.value.includes("language server started"));
                return Promise.resolve(line ?? null);
            });
            expect(started.channel).toBe("extensions.diode.diode-lsp-typescript.typescript-diode");
            expect(started.label).toBe("TypeScript (Diode)");
            expect(started.level).toBe("info");

            // Diagnostics double as the readiness signal "the server indexed the project" before go-to-definition.
            const marker = await until("'not assignable' diagnostic in main.ts", () => {
                const hit = markersFor(mainUri).find((m) => m.message.includes("not assignable to type 'number'"));
                return Promise.resolve(hit ?? null);
            });
            expect(marker.range.start.line).toBe(2);
            expect(marker.source).toBe("typescript");

            const definitionAt = (line: number, character: number) =>
                provideDefinitions(harness, {
                    uri: mainUri,
                    languageId: "typescript",
                    versionId: documentVersion(harness, mainUri),
                    line,
                    character,
                });
            const locations = await until("definition of the greet call", async () => {
                const found = await definitionAt(2, 23);
                return found.length > 0 ? found : null;
            });
            expect(locations[0].uri).toBe(defsUri);
            expect(locations[0].range.start).toMatchObject({ line: 0, character: 16 });

            // No save to disk: the server must see the live buffer.
            harness.group.openFile(defsPath);
            harness.group
                .getActiveEditor()
                ?.applyExternalEdits([createTextEdit(createRange(0, 0, 0, 0), "// prologue\n\n")], "unsaved edit");
            await settle();
            harness.group.openFile(mainPath);

            const moved = await until("definition after an unsaved edit of defs.ts", async () => {
                const found = await definitionAt(2, 23);
                return found.length > 0 && found[0].range.start.line === 2 ? found : null;
            });
            expect(moved[0].uri).toBe(defsUri);
            expect(moved[0].range.start).toMatchObject({ line: 2, character: 16 });

            harness.group
                .getActiveEditor()
                ?.applyExternalEdits([createTextEdit(createRange(2, 13, 2, 19), "string")], "fix type");
            await until("main.ts diagnostic gone after the fix", () =>
                Promise.resolve(markersFor(mainUri).length === 0 ? true : null),
            );

            // "Unexpected resource" regression: a file opened mid-session; didOpen must reach the server before
            // foldingRange, otherwise the client asks about an unknown document.
            const extraPath = harness.writeFile(
                "extra.ts",
                "export function block(): void {\n    void 0;\n    void 0;\n}\n",
            );
            const extraUri = Uri.file(extraPath).toString();
            harness.group.openFile(extraPath);
            const folds = await until("folds of the just-opened extra.ts", async () => {
                const found = await provideFoldingRegions(harness, {
                    uri: extraUri,
                    languageId: "typescript",
                    versionId: documentVersion(harness, extraUri),
                });
                return found.length > 0 ? found : null;
            });
            expect(folds[0]).toMatchObject({ startLine: 0 });

            // Regression of the tsserver crash "reading 'charCount'": a request with the new version goes out in the
            // same tick as the edit, overtaking the coalesced didChange; the mirror must be updated only by didChange.
            harness.group.openFile(mainPath);
            const editor = harness.group.getActiveEditor();
            editor?.applyExternalEdits([createTextEdit(createRange(4, 0, 4, 0), "\nconst tail = 1;\n")], "grow");
            const racing = provideFoldingRegions(harness, {
                uri: mainUri,
                languageId: "typescript",
                versionId: documentVersion(harness, mainUri),
            });
            await racing;
            editor?.applyExternalEdits([createTextEdit(createRange(2, 13, 2, 19), "number")], "break again");
            const reMarker = await until("diagnostic after the didChange/folding race", () => {
                const hit = markersFor(mainUri).find((m) => m.message.includes("not assignable to type 'number'"));
                return Promise.resolve(hit ?? null);
            });
            expect(reMarker.range.start.line).toBe(2);
            const serverErrors = outputLines.filter((l) =>
                /charCount|TypeScript Server Error|Unexpected resource|should be opened/i.test(l.value),
            );
            expect(serverErrors).toEqual([]);
        } finally {
            await harness.dispose();
        }
    });
});
