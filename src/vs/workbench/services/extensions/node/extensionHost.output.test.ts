import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost, type IOutputSink } from "./extensionHost.ts";

// Детерминированный in-process тест стока output-каналов (`output.append`/`show`):
// installHostHandlers на in-process RPC-паре (паттерн extensionHost.progress.test).

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
    const events: { kind: string; channel: string; label?: string; level?: string; value?: string }[] = [];
    const sink: IOutputSink = {
        append: (channel, label, level, value) => events.push({ kind: "append", channel, label, level, value }),
        show: (channel, label) => events.push({ kind: "show", channel, label }),
    };
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, withSink ? { outputSink: sink } : {});
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    return { host, peer, events };
}

describe("ExtensionHost — сток output-каналов (output.*, in-process)", () => {
    it("append и show доезжают до sink'а", async () => {
        const h = makeHost(true);
        h.peer.notify("output.append", {
            channel: "extensions.ts",
            label: "TS (Vexx)",
            level: "warn",
            value: "slow tsserver",
        });
        h.peer.notify("output.show", { channel: "extensions.ts", label: "TS (Vexx)" });
        await flushMicrotasks();

        expect(h.events).toEqual([
            { kind: "append", channel: "extensions.ts", label: "TS (Vexx)", level: "warn", value: "slow tsserver" },
            { kind: "show", channel: "extensions.ts", label: "TS (Vexx)" },
        ]);
    });

    it("битые конверты игнорируются; без sink'а не падает", async () => {
        const h = makeHost(true);
        h.peer.notify("output.append", null);
        h.peer.notify("output.append", { channel: "", label: "x", level: "info", value: "v" });
        h.peer.notify("output.append", { channel: "c", label: "", level: "info", value: "v" });
        h.peer.notify("output.append", { channel: "c", label: "x", level: "loud", value: "v" });
        h.peer.notify("output.append", { channel: "c", label: "x", level: "info", value: 42 });
        h.peer.notify("output.show", { channel: "" });
        h.peer.notify("output.show", { channel: "c" });
        h.peer.notify("output.show", "junk");
        await flushMicrotasks();
        expect(h.events).toEqual([]);

        const silent = makeHost(false);
        silent.peer.notify("output.append", { channel: "c", label: "x", level: "info", value: "v" });
        silent.peer.notify("output.show", { channel: "c", label: "x" });
        await flushMicrotasks();
        expect(silent.events).toEqual([]);
    });
});
