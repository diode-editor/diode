import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";
import type { WireMarker } from "../../../api/common/wireTypes.ts";

import { type DiagnosticsSink, ExtensionHost } from "./extensionHost.ts";

// Детерминированный in-process тест стока диагностик (`diagnostics.publish`):
// вместо форка subprocess'а гоняем `installHostHandlers` на in-process RPC-паре
// (паттерн extensionHost.decorationsInProcess.test.ts).

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
    startLine: 2,
    startCharacter: 4,
    endLine: 2,
    endCharacter: 9,
    message: "Type error",
    code: "2322",
    source: "ts",
};

describe("ExtensionHost — сток диагностик (diagnostics.publish, in-process)", () => {
    it("валидная публикация доезжает до sink'а; невалидные маркеры отбрасываются", async () => {
        const h = makeHost(true);
        const bare = { severity: 0, startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 1, message: "no code" };
        h.peer.notify("diagnostics.publish", {
            owner: "ext:ts",
            resource: "file:///proj/main.ts",
            markers: [MARKER, bare, { junk: true }, "nope"],
        });
        await flushMicrotasks();

        expect(h.published).toEqual([{ owner: "ext:ts", resource: "file:///proj/main.ts", markers: [MARKER, bare] }]);
    });

    it("битый конверт игнорируется целиком", async () => {
        const h = makeHost(true);
        h.peer.notify("diagnostics.publish", null);
        h.peer.notify("diagnostics.publish", { owner: "", resource: "file:///a", markers: [] });
        h.peer.notify("diagnostics.publish", { owner: "ext:ts", resource: "", markers: [] });
        h.peer.notify("diagnostics.publish", { owner: "ext:ts", resource: "file:///a", markers: "junk" });
        await flushMicrotasks();

        expect(h.published).toEqual([]);
    });

    it("без sink'а публикация не роняет host", async () => {
        const h = makeHost(false);
        h.peer.notify("diagnostics.publish", { owner: "ext:ts", resource: "file:///a", markers: [MARKER] });
        await flushMicrotasks();
        expect(h.published).toEqual([]);
    });
});

describe("ExtensionHost — сток диагностик сквозняком (subprocess)", () => {
    it("createDiagnosticCollection расширения доезжает до sink'а и чистится", async () => {
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
                    owner: "ext:fixture",
                    resource: uri,
                    markers: [
                        {
                            severity: 1,
                            startLine: 0,
                            startCharacter: 1,
                            endLine: 0,
                            endCharacter: 5,
                            message: "Broken type",
                            source: "fixture",
                        },
                    ],
                },
            ]);

            await harness.commandRegistry.execute("test.diag.clear");
            await harness.flushRpc();
            expect(published.at(-1)).toEqual({ owner: "ext:fixture", resource: uri, markers: [] });
        } finally {
            await harness.dispose();
        }
    });
});
