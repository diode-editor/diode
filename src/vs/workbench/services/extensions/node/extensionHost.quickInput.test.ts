import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import type { IQuickInputBoxRequest, IQuickInputSink } from "../../../api/common/iExtensionWindowSinks.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";
import type {
    IWireQuickPickEvent,
    IWireQuickPickRequest,
    IWireQuickPickUpdate,
    IWireValidationMessage,
} from "../../../api/common/wireTypes.ts";

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
    registerProxy: () => ({ dispose: () => undefined }),
} as unknown as ICommandService;

interface IStubSink extends IQuickInputSink {
    readonly inputRequests: IQuickInputBoxRequest[];
    readonly pickRequests: IWireQuickPickRequest[];
    readonly cancelled: number[];
    readonly quickPickUpdates: IWireQuickPickUpdate[];
    readonly disposedQuickPicks: number[];
    readonly emit: { current: ((event: IWireQuickPickEvent) => void) | null };
    /** By default the prompt stays pending. */
    settleInput(value: string | undefined): void;
    settlePick(indices: readonly number[] | undefined): void;
}

function makeSink(): IStubSink {
    const inputRequests: IQuickInputBoxRequest[] = [];
    const pickRequests: IWireQuickPickRequest[] = [];
    const cancelled: number[] = [];
    const quickPickUpdates: IWireQuickPickUpdate[] = [];
    const disposedQuickPicks: number[] = [];
    const emit: { current: ((event: IWireQuickPickEvent) => void) | null } = { current: null };
    let resolveInput: ((value: string | undefined) => void) | null = null;
    let resolvePick: ((value: readonly number[] | undefined) => void) | null = null;
    return {
        inputRequests,
        pickRequests,
        cancelled,
        quickPickUpdates,
        disposedQuickPicks,
        emit,
        updateQuickPick: (update, emitEvent) => {
            quickPickUpdates.push(update);
            emit.current = emitEvent;
        },
        disposeQuickPick: (handle) => {
            disposedQuickPicks.push(handle);
        },
        showInputBox: (request) => {
            inputRequests.push(request);
            return new Promise((resolve) => {
                resolveInput = resolve;
            });
        },
        showQuickPick: (request) => {
            pickRequests.push(request);
            return new Promise((resolve) => {
                resolvePick = resolve;
            });
        },
        cancel: (handle) => {
            cancelled.push(handle);
            resolveInput?.(undefined);
            resolvePick?.(undefined);
        },
        settleInput: (value) => resolveInput?.(value),
        settlePick: (indices) => resolvePick?.(indices),
    };
}

function makeHost(sink?: IQuickInputSink) {
    const host = new ExtensionHost(
        NOOP_EDITOR_OPTIONS,
        NOOP_COMMANDS,
        sink !== undefined ? { quickInputSink: sink } : {},
    );
    const [a, b] = createInProcessChannelPair();
    /** Exceptions from notification handlers are visible only here. */
    const warnings: string[] = [];
    const rpcLogger = {
        trace: () => undefined,
        debug: () => undefined,
        info: () => undefined,
        warn: (message: string) => warnings.push(message),
        error: () => undefined,
    } as unknown as ILogger;
    const hostRpc = new RpcEndpoint(a, rpcLogger);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    return { host, peer, warnings };
}

describe("ExtensionHost — window.showInputBox", () => {
    it("options reach the sink, and the input goes back to the extension", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        const pending = peer.request("window.showInputBox", {
            handle: 3,
            title: "Your name",
            prompt: "How should we address you",
            placeHolder: "name",
            value: "Ada",
            validates: false,
        });
        await flushMicrotasks();
        expect(sink.inputRequests[0]).toMatchObject({
            handle: 3,
            title: "Your name",
            prompt: "How should we address you",
            placeHolder: "name",
            value: "Ada",
        });
        sink.settleInput("Ada Lovelace");
        await expect(pending).resolves.toEqual({ value: "Ada Lovelace" });
    });

    it("password reaches the sink: the host draws the mask, not the extension", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        void peer.request("window.showInputBox", { handle: 3, password: true, validates: false });
        await flushMicrotasks();
        expect(sink.inputRequests[0]).toMatchObject({ handle: 3, password: true });
    });

    it("cancelling the prompt answers the extension with null", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        const pending = peer.request("window.showInputBox", { handle: 1, validates: false });
        await flushMicrotasks();
        sink.settleInput(undefined);
        await expect(pending).resolves.toEqual({ value: null });
    });

    it("empty string is not a cancellation", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        const pending = peer.request("window.showInputBox", { handle: 1, validates: false });
        await flushMicrotasks();
        sink.settleInput("");
        await expect(pending).resolves.toEqual({ value: "" });
    });

    it("without a sink the extension gets `cancelled` immediately instead of hanging", async () => {
        const { peer } = makeHost();
        await expect(peer.request("window.showInputBox", { handle: 1, validates: false })).resolves.toEqual({
            value: null,
        });
    });

    it("garbage params mean `cancelled`", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        await expect(peer.request("window.showInputBox", { handle: "no" })).resolves.toEqual({ value: null });
        expect(sink.inputRequests).toHaveLength(0);
    });

    it("validates: true gives the sink a validation channel back to the extension", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        peer.handleRequest("window.inputBox.validate", (params) => {
            const p = params as { handle: number; value: string };
            return p.value === "ab" ? { message: "Digits only", severity: "error" } : null;
        });
        const pending = peer.request("window.showInputBox", { handle: 5, validates: true });
        await flushMicrotasks();
        const validate = sink.inputRequests[0]?.validate;
        expect(validate).toBeTypeOf("function");
        await expect(validate?.("ab")).resolves.toEqual({ message: "Digits only", severity: "error" });
        await expect(validate?.("8080")).resolves.toBeNull();
        sink.settleInput("8080");
        await pending;
    });

    it("without validates the sink has no validation channel at all", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        const pending = peer.request("window.showInputBox", { handle: 5, validates: false });
        await flushMicrotasks();
        expect(sink.inputRequests[0]?.validate).toBeUndefined();
        sink.settleInput("x");
        await pending;
    });

    it("a throwing extension validator treats the value as valid instead of hanging the box", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        peer.handleRequest("window.inputBox.validate", () => {
            throw new Error("extension broke");
        });
        const pending = peer.request("window.showInputBox", { handle: 5, validates: true });
        await flushMicrotasks();
        const validate = sink.inputRequests[0]?.validate as (v: string) => Promise<IWireValidationMessage | null>;
        await expect(validate("ab")).resolves.toBeNull();
        sink.settleInput("ab");
        await pending;
    });
});

describe("ExtensionHost — window.showQuickPick", () => {
    it("items reach the sink, indices go back to the extension", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        const pending = peer.request("window.showQuickPick", {
            handle: 2,
            placeHolder: "Pick a fruit",
            canPickMany: false,
            items: [{ label: "apple" }, { label: "banana", description: "yellow" }],
            picked: [],
        });
        await flushMicrotasks();
        expect(sink.pickRequests[0]).toEqual({
            handle: 2,
            placeHolder: "Pick a fruit",
            canPickMany: false,
            items: [{ label: "apple" }, { label: "banana", description: "yellow" }],
            picked: [],
        });
        sink.settlePick([1]);
        await expect(pending).resolves.toEqual({ indices: [1] });
    });

    it("cancel answers null, an empty selection answers an empty array", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        const cancelled = peer.request("window.showQuickPick", { handle: 1, items: [], picked: [] });
        await flushMicrotasks();
        sink.settlePick(undefined);
        await expect(cancelled).resolves.toEqual({ indices: null });

        const empty = peer.request("window.showQuickPick", { handle: 2, items: [], canPickMany: true, picked: [] });
        await flushMicrotasks();
        sink.settlePick([]);
        await expect(empty).resolves.toEqual({ indices: [] });
    });

    it("preselection is dropped without canPickMany", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        const pending = peer.request("window.showQuickPick", {
            handle: 1,
            items: [{ label: "a" }, { label: "b" }],
            picked: [1],
        });
        await flushMicrotasks();
        expect(sink.pickRequests[0]?.picked).toEqual([]);
        sink.settlePick(undefined);
        await pending;
    });

    it("without a sink the extension gets `cancelled` immediately", async () => {
        const { peer } = makeHost();
        await expect(peer.request("window.showQuickPick", { handle: 1, items: [], picked: [] })).resolves.toEqual({
            indices: null,
        });
    });

    it("garbage params mean `cancelled`", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        await expect(peer.request("window.showQuickPick", { handle: 1 })).resolves.toEqual({ indices: null });
        expect(sink.pickRequests).toHaveLength(0);
    });
});

describe("ExtensionHost — window.quickInput.cancel", () => {
    it("the extension's token dismisses the prompt through the sink", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        const pending = peer.request("window.showInputBox", { handle: 4, validates: false });
        await flushMicrotasks();
        peer.notify("window.quickInput.cancel", { handle: 4 });
        await expect(pending).resolves.toEqual({ value: null });
        expect(sink.cancelled).toEqual([4]);
    });

    it("a garbage cancel never reaches the sink", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        peer.notify("window.quickInput.cancel", {});
        peer.notify("window.quickInput.cancel", { handle: "no" });
        await flushMicrotasks();
        expect(sink.cancelled).toEqual([]);
    });
});

describe("ExtensionHost — tracking of live prompts", () => {
    it("a finished prompt is untracked: the next death does not dismiss it", async () => {
        const sink = makeSink();
        const { host, peer } = makeHost(sink);
        const first = peer.request("window.showQuickPick", { handle: 21, items: [], picked: [] });
        await flushMicrotasks();
        sink.settlePick([]);
        await first;

        host.dispose();
        expect(sink.cancelled).toEqual([]);
    });

    it("several live prompts are all dismissed", async () => {
        const sink = makeSink();
        const { host, peer } = makeHost(sink);
        void peer.request("window.showInputBox", { handle: 31, validates: false });
        void peer.request("window.showQuickPick", { handle: 32, items: [], picked: [] });
        await flushMicrotasks();

        host.dispose();
        expect([...sink.cancelled].sort((a, b) => a - b)).toEqual([31, 32]);
    });

    it("after death the live prompt set is empty, so a repeated dispose is silent", async () => {
        const sink = makeSink();
        const { host, peer } = makeHost(sink);
        void peer.request("window.showInputBox", { handle: 41, validates: false });
        await flushMicrotasks();
        host.dispose();
        expect(sink.cancelled).toEqual([41]);

        host.dispose();
        expect(sink.cancelled).toEqual([41]);
    });

    it("without a sink a token cancel crashes nothing", async () => {
        const { peer } = makeHost();
        peer.notify("window.quickInput.cancel", { handle: 1 });
        await flushMicrotasks();
        await expect(peer.request("window.showInputBox", { handle: 1, validates: false })).resolves.toEqual({
            value: null,
        });
    });
});

describe("ExtensionHost — subprocess death with an open overlay", () => {
    it("live prompts are dismissed: no ownerless overlay stays on screen", async () => {
        const sink = makeSink();
        const { host, peer } = makeHost(sink);
        void peer.request("window.showInputBox", { handle: 11, validates: false });
        await flushMicrotasks();
        expect(sink.cancelled).toEqual([]);

        host.dispose();
        expect(sink.cancelled).toEqual([11]);
    });

    it("a finished prompt is not dismissed again on death", async () => {
        const sink = makeSink();
        const { host, peer } = makeHost(sink);
        const pending = peer.request("window.showInputBox", { handle: 12, validates: false });
        await flushMicrotasks();
        sink.settleInput("done");
        await pending;

        host.dispose();
        expect(sink.cancelled).toEqual([]);
    });
});

describe("ExtensionHost — window.createQuickPick", () => {
    it("an update reaches the sink as a diff: a missing field means `untouched`, null means `reset`", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        peer.notify("window.quickPick.update", {
            handle: 7,
            visible: true,
            title: null,
            placeholder: "Type to search",
            matchOnDescription: true,
            items: [
                { handle: 0, label: "Alpha", detail: "example.com/alpha" },
                { handle: 2, label: "Gamma", alwaysShow: true },
            ],
            activeItems: [2],
        });
        await flushMicrotasks();
        expect(sink.quickPickUpdates).toEqual([
            {
                handle: 7,
                visible: true,
                title: null,
                placeholder: "Type to search",
                matchOnDescription: true,
                items: [
                    {
                        handle: 0,
                        label: "Alpha",
                        description: undefined,
                        detail: "example.com/alpha",
                        alwaysShow: false,
                    },
                    { handle: 2, label: "Gamma", description: undefined, detail: undefined, alwaysShow: true },
                ],
                activeItems: [2],
            },
        ]);
    });

    it("user actions go back to the same subprocess as events", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        const received: unknown[] = [];
        peer.handleNotification("window.quickPick.event", (params) => {
            received.push(params);
        });
        peer.notify("window.quickPick.update", { handle: 7, visible: true });
        await flushMicrotasks();

        sink.emit.current?.({ handle: 7, kind: "changeValue", value: "al" });
        sink.emit.current?.({ handle: 7, kind: "changeSelection", items: [0] });
        sink.emit.current?.({ handle: 7, kind: "accept" });
        await flushMicrotasks();

        expect(received).toEqual([
            { handle: 7, kind: "changeValue", value: "al" },
            { handle: 7, kind: "changeSelection", items: [0] },
            { handle: 7, kind: "accept" },
        ]);
    });

    it("extension dispose removes the picker; foreign and garbage handles never reach the sink", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        peer.notify("window.quickPick.update", { handle: 7, visible: true });
        peer.notify("window.quickPick.dispose", { handle: 8 });
        peer.notify("window.quickPick.dispose", { handle: "no" });
        peer.notify("window.quickPick.update", { handle: "no" });
        peer.notify("window.quickPick.dispose", { handle: 7 });
        await flushMicrotasks();
        expect(sink.quickPickUpdates.map((u) => u.handle)).toEqual([7]);
        expect(sink.disposedQuickPicks).toEqual([7]);
    });

    it("a garbage update and pickers without a sink crash nothing", async () => {
        const sink = makeSink();
        const withSink = makeHost(sink);
        withSink.peer.notify("window.quickPick.update", null);
        withSink.peer.notify("window.quickPick.dispose", null);
        await flushMicrotasks();
        expect(withSink.warnings).toEqual([]);
        expect(sink.quickPickUpdates).toEqual([]);

        const bare = makeHost();
        bare.peer.notify("window.quickPick.update", { handle: 7, visible: true });
        bare.peer.notify("window.quickPick.update", { handle: 8, visible: true });
        bare.peer.notify("window.quickPick.dispose", { handle: 7 });
        await flushMicrotasks();
        expect(bare.warnings).toEqual([]);
        expect(() => {
            bare.host.dispose();
        }).not.toThrow();
    });

    it("subprocess death removes live pickers, and they send no events into the dead channel", async () => {
        const sink = makeSink();
        const { host, peer } = makeHost(sink);
        const received: unknown[] = [];
        peer.handleNotification("window.quickPick.event", (params) => {
            received.push(params);
        });
        peer.notify("window.quickPick.update", { handle: 7, visible: true });
        peer.notify("window.quickPick.update", { handle: 9, visible: false });
        peer.notify("window.quickPick.dispose", { handle: 9 });
        await flushMicrotasks();

        host.dispose();
        expect(sink.disposedQuickPicks).toEqual([9, 7]);
        // A picker torn down by the death still reports its hide, to nobody.
        sink.emit.current?.({ handle: 7, kind: "hide" });
        await flushMicrotasks();
        expect(received).toEqual([]);
    });
});
