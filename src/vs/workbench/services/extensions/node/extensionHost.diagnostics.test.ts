import { describe, expect, it, vi } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { MarkerSeverity } from "../../../../platform/markers/common/iMarker.ts";
import { MarkerService } from "../../../../platform/markers/common/markerService.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import type { DiagnosticsSink } from "../../../api/common/iExtensionWindowSinks.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";
import type { WireMarker } from "../../../api/common/wireTypes.ts";

import { ExtensionHost } from "./extensionHost.ts";

const NOOP_EDITOR_OPTIONS = {
    getActiveEditorOptions: () => null,
    setActiveEditorOptions: () => undefined,
    getActiveEditorFilePath: () => null,
    getActiveEditorMeta: () => ({ uri: null, languageId: null, isDirty: false }),
    onActiveEditorChanged: () => ({ dispose: () => undefined }),
    onActiveEditorSelectionChanged: () => ({ dispose: () => undefined }),
    setActiveEditorSelections: () => undefined,
    applyActiveEditorEdits: () => true,
} as unknown as IEditorOptionsService;

const NOOP_COMMANDS = {
    execute: () => undefined,
    listCommandIds: () => [],
    registerProxy: () => ({ dispose: () => undefined }),
} as unknown as ICommandService;

function makeHost(withSink: boolean) {
    const published: { owner: string; resource: string; markers: readonly WireMarker[] }[] = [];
    const sink: DiagnosticsSink = (owner, resource, markers) => published.push({ owner, resource, markers });
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, withSink ? { diagnosticsSink: sink } : {});
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    return { host, peer, published };
}

const MARKER: WireMarker = {
    severity: 1,
    range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } },
    message: "Type error",
    code: "2322",
    source: "ts",
};

describe("ExtensionHost — diagnostics sink (diagnostics.publish, in-process)", () => {
    it("a valid publish reaches the sink; invalid markers are dropped", async () => {
        const h = makeHost(true);
        const bare = {
            severity: 0,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            message: "no code",
        };
        h.peer.notify("diagnostics.publish", {
            owner: "ext:ts",
            resource: "file:///proj/main.ts",
            markers: [
                MARKER,
                bare,
                { junk: true },
                "nope",
                { ...MARKER, severity: "1" },
                { ...MARKER, range: { start: { line: 0, character: 0 } } },
                { ...MARKER, message: 5 },
            ],
        });
        await flushMicrotasks();

        expect(h.published).toEqual([{ owner: "ext:ts", resource: "file:///proj/main.ts", markers: [MARKER, bare] }]);
    });

    it("a broken envelope is ignored entirely", async () => {
        const h = makeHost(true);
        h.peer.notify("diagnostics.publish", null);
        h.peer.notify("diagnostics.publish", { owner: "", resource: "file:///a", markers: [] });
        h.peer.notify("diagnostics.publish", { owner: "ext:ts", resource: "", markers: [] });
        h.peer.notify("diagnostics.publish", { owner: "ext:ts", resource: "file:///a", markers: "junk" });
        await flushMicrotasks();

        expect(h.published).toEqual([]);
    });

    it("without a sink a publish does not crash the host", async () => {
        const h = makeHost(false);
        h.peer.notify("diagnostics.publish", { owner: "ext:ts", resource: "file:///a", markers: [MARKER] });
        await flushMicrotasks();
        expect(h.published).toEqual([]);
    });
});

describe("ExtensionHost — diagnostics sink end to end (subprocess)", () => {
    it("an extension's createDiagnosticCollection reaches the sink and gets cleared", async () => {
        const published: { owner: string; resource: string; markers: readonly WireMarker[] }[] = [];
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.publishesDiagnostics", "publishesDiagnostics.cjs")],
            diagnosticsSink: (owner, resource, markers) => published.push({ owner, resource, markers }),
        });
        try {
            const uri = "file:///proj/main.ts";
            await harness.commandRegistry.execute("test.diag.publish", uri, "Broken type");
            await harness.flushRpc();
            expect(published).toEqual([
                {
                    owner: "ext:test.publishesDiagnostics:fixture",
                    resource: uri,
                    markers: [
                        {
                            severity: 1,
                            range: { start: { line: 0, character: 1 }, end: { line: 0, character: 5 } },
                            message: "Broken type",
                            source: "fixture",
                        },
                    ],
                },
            ]);

            await harness.commandRegistry.execute("test.diag.clear");
            await harness.flushRpc();
            expect(published.at(-1)).toEqual({
                owner: "ext:test.publishesDiagnostics:fixture",
                resource: uri,
                markers: [],
            });
        } finally {
            await harness.dispose();
        }
    });
});

describe("ExtensionHost — diagnostics return path end to end (subprocess)", () => {
    const SEVERITY = [MarkerSeverity.Error, MarkerSeverity.Warning, MarkerSeverity.Info, MarkerSeverity.Hint];
    function bridge(markerService: MarkerService): DiagnosticsSink {
        return (owner, resource, markers) => {
            markerService.changeOne(
                owner,
                resource,
                markers.map((m) => ({ ...m, severity: SEVERITY[m.severity] ?? MarkerSeverity.Error })),
            );
        };
    }
    const SETTINGS = "file:///proj/settings.json";
    const MAIN = "file:///proj/main.ts";
    const RANGE = { start: { line: 3, character: 0 }, end: { line: 3, character: 7 } };

    it("getDiagnostics sees foreign markers (seed and stream) and its own once; onDidChangeDiagnostics fires", async () => {
        const markerService = new MarkerService();
        markerService.changeOne("settings", SETTINGS, [
            { severity: MarkerSeverity.Warning, range: RANGE, message: "Unknown setting", source: "settings" },
        ]);
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.publishesDiagnostics", "publishesDiagnostics.cjs")],
            diagnosticsSink: bridge(markerService),
            markers: markerService,
        });
        const get = (uri?: string) => harness.commandRegistry.execute("test.diag.get", uri);
        try {
            expect(await get(SETTINGS)).toEqual([
                { message: "Unknown setting", severity: 1, source: "settings", range: [3, 0, 3, 7] },
            ]);

            await harness.commandRegistry.execute("test.diag.publish", MAIN, "Broken type");
            markerService.changeOne("tasks", MAIN, [
                { severity: MarkerSeverity.Error, range: RANGE, message: "Build failed", code: "TS1" },
            ]);
            await harness.flushRpc();

            // The mirror was seeded before activation, so it comes first in the set
            // (upstream also keeps insertion order).
            expect(await get(MAIN)).toEqual([
                { message: "Build failed", severity: 0, code: "TS1", range: [3, 0, 3, 7] },
                { message: "Broken type", severity: 1, source: "fixture", range: [0, 1, 0, 5] },
            ]);
            expect(await get()).toEqual([
                [SETTINGS, [expect.objectContaining({ message: "Unknown setting" })]],
                [
                    MAIN,
                    [
                        expect.objectContaining({ message: "Build failed" }),
                        expect.objectContaining({ message: "Broken type" }),
                    ],
                ],
            ]);
            // Event windows depend on activation timing, so check the contents.
            await vi.waitFor(async () => {
                const changes = (await harness.commandRegistry.execute("test.diag.changes")) as string[][];
                expect(changes.flat()).toEqual(expect.arrayContaining([SETTINGS, MAIN]));
            });

            markerService.changeOne("tasks", MAIN, []);
            await harness.flushRpc();
            expect(await get(MAIN)).toEqual([expect.objectContaining({ message: "Broken type" })]);
        } finally {
            await harness.dispose();
        }
    });
});
