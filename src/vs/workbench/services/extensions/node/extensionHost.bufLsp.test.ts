import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLIENT_CRASH_PATTERNS, until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    BUF_ID,
    ensureBufCli,
    type IInstalledBuf,
    installBuf,
    MAIN_PROTO,
    PROTO_LANGUAGE_SERVICE,
    UNFORMATTED_PROTO,
} from "../../../../../TestUtils/bufFixture.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    formatDocumentFor,
    type IExtensionHarness,
    provideCompletions,
    provideDefinitions,
    provideHovers,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { WireMarker } from "../../../api/common/wireTypes.ts";

// Protocol Buffers "as the user has it": the REAL third-party vsix bufbuild.vscode-buf from the marketplace, installed
// by the regular installVsix, on a real extension host subprocess, and a real `buf lsp serve`. The suite holds that
// the extension activates on workspaceContains, starts the server and its features reach the core: diagnostics, hover,
// F12, completion, formatting.

let installed: IInstalledBuf;
let bufCli: string;

// The vsix comes from the marketplace and the buf binary from GitHub (see bufFixture.ts): skipped offline.
describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — stock bufbuild.vscode-buf (buf LSP, end to end)", () => {
    beforeAll(async () => {
        [installed, bufCli] = await Promise.all([installBuf(), ensureBufCli()]);
        expect(installed.registration.id).toBe(BUF_ID);
    }, 180_000);

    afterAll(() => {
        installed.dispose();
    });

    it(
        "activates without errors; diagnostics, hover, F12, completion and formatting from buf",
        { timeout: 240_000 },
        async () => {
            const published: { resource: string; markers: readonly WireMarker[] }[] = [];
            const outputLines: { level: string; value: string }[] = [];
            const harness: IExtensionHarness = await createExtensionTestHarness({
                languageService: PROTO_LANGUAGE_SERVICE,
                activateEvents: [],
                configuration: { buf: { commandLine: { path: bufCli } } },
                diagnosticsSink: (_owner, resource, markers) => published.push({ resource, markers }),
                outputSink: {
                    append: (_channel, _label, level, value) => outputLines.push({ level, value }),
                    show: () => undefined,
                },
                extensions: [installed.registration],
            });
            try {
                const mainPath = harness.writeFile("demo.proto", MAIN_PROTO);
                const mainUri = Uri.file(mainPath).toString();
                const pointPath = harness.writeFile("point.proto", UNFORMATTED_PROTO);
                const pointUri = Uri.file(pointPath).toString();
                harness.group.openFile(pointPath);
                harness.group.openFile(mainPath);
                // The manifest activates the extension on `workspaceContains:**/*.proto`, with the same workspace walk
                // as the app at startup.
                await harness.host.activateByWorkspaceContains();
                expect(harness.host.hasExtension(BUF_ID)).toBe(true);

                // A diagnostic from the REAL buf is the server's readiness signal. The import of a well-known type gives
                // no error: buf knows them with no setup.
                const unknown = await until("Usr diagnostic", () => {
                    const markers = published.filter((p) => p.resource === mainUri).at(-1)?.markers ?? [];
                    return Promise.resolve(markers.find((m) => m.message.includes("`Usr`")) ?? null);
                });
                expect(unknown.range.start.line).toBe(10);
                const markers = published.filter((p) => p.resource === mainUri).at(-1)?.markers ?? [];
                expect(markers.filter((m) => m.message.includes("timestamp"))).toEqual([]);

                const at = (uri: string, line: number, character: number) => ({
                    uri,
                    languageId: "proto",
                    versionId: documentVersion(harness, uri),
                    line,
                    character,
                });

                // A hover over `User` in the rpc shows the message's doc comment.
                const hovers = await provideHovers(harness, at(mainUri, 15, 11));
                expect(hovers.flatMap((hover) => hover.contents).join("\n")).toContain("A user of the demo service.");

                // F12 from `User` in the rpc goes to the name in `message User`.
                const definitions = await provideDefinitions(harness, at(mainUri, 15, 11));
                expect(definitions).toEqual([expect.objectContaining({ uri: mainUri })]);
                expect(definitions[0]?.range.start).toEqual({ line: 6, character: 8 });

                // Completion on the empty line of the message body offers field types.
                const completions = await provideCompletions(harness, at(mainUri, 11, 2));
                const labels = completions.items.map((item) => item.label);
                expect(labels).toContain("User");
                expect(labels).toContain("google.protobuf.Timestamp");

                // Format Document on the second file: indentation and spacing as `buf format` does.
                const edits = await formatDocumentFor(harness, {
                    uri: pointUri,
                    languageId: "proto",
                    versionId: documentVersion(harness, pointUri),
                    tabSize: 2,
                    insertSpaces: true,
                });
                const formatted = (edits ?? []).map((edit) => edit.text).join("");
                expect(formatted).toContain("message Point {\n  int32 x = 1;\n}");

                // The stock client's converters did not fail silently (the convention of the TS suites).
                const crashes = outputLines.filter((l) => CLIENT_CRASH_PATTERNS.test(l.value));
                expect(crashes).toEqual([]);
            } finally {
                await harness.dispose();
            }
        },
    );
});
