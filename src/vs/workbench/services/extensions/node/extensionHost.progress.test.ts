import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";

import { ExtensionHost, type IProgressSink } from "./extensionHost.ts";

// Детерминированный in-process тест стока прогресса (`window.progress.*`):
// installHostHandlers на in-process RPC-паре (паттерн extensionHost.diagnostics.test).

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
    const events: { kind: string; handle: number; message?: string; increment?: number; title?: string }[] = [];
    const sink: IProgressSink = {
        start: (handle, title) => events.push({ kind: "start", handle, title }),
        report: (handle, message, increment) => events.push({ kind: "report", handle, message, increment }),
        end: (handle) => events.push({ kind: "end", handle }),
    };
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, withSink ? { progressSink: sink } : {});
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    return { host, peer, events };
}

describe("ExtensionHost — сток прогресса (window.progress.*, in-process)", () => {
    it("start/report/end доезжают до sink'а в порядке прихода", async () => {
        const h = makeHost(true);
        h.peer.notify("window.progress.start", { handle: 1, title: "TS: starting" });
        h.peer.notify("window.progress.report", { handle: 1, message: "loading", increment: 25 });
        h.peer.notify("window.progress.report", { handle: 1 });
        h.peer.notify("window.progress.end", { handle: 1 });
        await flushMicrotasks();

        expect(h.events).toEqual([
            { kind: "start", handle: 1, title: "TS: starting" },
            { kind: "report", handle: 1, message: "loading", increment: 25 },
            { kind: "report", handle: 1, message: undefined, increment: undefined },
            { kind: "end", handle: 1 },
        ]);
    });

    it("битые конверты игнорируются; без sink'а не падает", async () => {
        const h = makeHost(true);
        h.peer.notify("window.progress.start", null);
        h.peer.notify("window.progress.start", { handle: "x", title: "t" });
        h.peer.notify("window.progress.start", { handle: 1 });
        h.peer.notify("window.progress.report", { handle: "x" });
        h.peer.notify("window.progress.report", "junk");
        h.peer.notify("window.progress.end", { title: "no handle" });
        h.peer.notify("window.progress.end", 5);
        await flushMicrotasks();
        expect(h.events).toEqual([]);

        const silent = makeHost(false);
        silent.peer.notify("window.progress.start", { handle: 1, title: "t" });
        silent.peer.notify("window.progress.report", { handle: 1 });
        silent.peer.notify("window.progress.end", { handle: 1 });
        await flushMicrotasks();
        expect(silent.events).toEqual([]);
    });

    it("смерть subprocess'а гасит живые прогрессы (end от хоста)", async () => {
        const h = makeHost(true);
        h.peer.notify("window.progress.start", { handle: 1, title: "a" });
        h.peer.notify("window.progress.start", { handle: 2, title: "b" });
        h.peer.notify("window.progress.end", { handle: 1 });
        await flushMicrotasks();

        h.host.dispose();
        await flushMicrotasks();

        const ends = h.events.filter((e) => e.kind === "end").map((e) => e.handle);
        // handle 1 закрыт расширением; handle 2 — хостом на shutdown, и только он.
        expect(ends).toEqual([1, 2]);
    });
});
