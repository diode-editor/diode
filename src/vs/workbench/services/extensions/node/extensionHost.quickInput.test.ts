import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";
import type { IWireQuickPickRequest, IWireValidationMessage } from "../../../api/common/wireTypes.ts";

import type { IQuickInputBoxRequest, IQuickInputSink } from "./extensionHost.ts";
import { ExtensionHost } from "./extensionHost.ts";

// Детерминированный in-process тест стока quick input'а
// (`window.showInputBox` / `window.showQuickPick` / `window.quickInput.cancel`):
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

interface IStubSink extends IQuickInputSink {
    readonly inputRequests: IQuickInputBoxRequest[];
    readonly pickRequests: IWireQuickPickRequest[];
    readonly cancelled: number[];
    /** Резолв висящего showInputBox (по умолчанию показ висит). */
    settleInput(value: string | undefined): void;
    settlePick(indices: readonly number[] | undefined): void;
}

function makeSink(): IStubSink {
    const inputRequests: IQuickInputBoxRequest[] = [];
    const pickRequests: IWireQuickPickRequest[] = [];
    const cancelled: number[] = [];
    let resolveInput: ((value: string | undefined) => void) | null = null;
    let resolvePick: ((value: readonly number[] | undefined) => void) | null = null;
    return {
        inputRequests,
        pickRequests,
        cancelled,
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
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    return { host, peer };
}

describe("ExtensionHost — window.showInputBox", () => {
    it("опции доезжают до стока, а введённое — обратно расширению", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        const pending = peer.request("window.showInputBox", {
            handle: 3,
            title: "Your name",
            prompt: "Как к вам",
            placeHolder: "имя",
            value: "Ада",
            validates: false,
        });
        await flushMicrotasks();
        expect(sink.inputRequests[0]).toMatchObject({
            handle: 3,
            title: "Your name",
            prompt: "Как к вам",
            placeHolder: "имя",
            value: "Ада",
        });
        sink.settleInput("Ада Лавлейс");
        await expect(pending).resolves.toEqual({ value: "Ада Лавлейс" });
    });

    it("password доезжает до стока — маску рисует хост, а не расширение", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        void peer.request("window.showInputBox", { handle: 3, password: true, validates: false });
        await flushMicrotasks();
        expect(sink.inputRequests[0]).toMatchObject({ handle: 3, password: true });
    });

    it("отмена показа отвечает расширению null", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        const pending = peer.request("window.showInputBox", { handle: 1, validates: false });
        await flushMicrotasks();
        sink.settleInput(undefined);
        await expect(pending).resolves.toEqual({ value: null });
    });

    it("пустая строка — не отмена", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        const pending = peer.request("window.showInputBox", { handle: 1, validates: false });
        await flushMicrotasks();
        sink.settleInput("");
        await expect(pending).resolves.toEqual({ value: "" });
    });

    it("без стока расширение получает «отменено» сразу, а не виснет", async () => {
        const { peer } = makeHost();
        await expect(peer.request("window.showInputBox", { handle: 1, validates: false })).resolves.toEqual({
            value: null,
        });
    });

    it("мусорные параметры — «отменено»", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        await expect(peer.request("window.showInputBox", { handle: "нет" })).resolves.toEqual({ value: null });
        expect(sink.inputRequests).toHaveLength(0);
    });

    it("validates: true даёт стоку канал валидации обратно в расширение", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        peer.handleRequest("window.inputBox.validate", (params) => {
            const p = params as { handle: number; value: string };
            return p.value === "ab" ? { message: "Только цифры", severity: "error" } : null;
        });
        const pending = peer.request("window.showInputBox", { handle: 5, validates: true });
        await flushMicrotasks();
        const validate = sink.inputRequests[0]?.validate;
        expect(validate).toBeTypeOf("function");
        await expect(validate?.("ab")).resolves.toEqual({ message: "Только цифры", severity: "error" });
        await expect(validate?.("8080")).resolves.toBeNull();
        sink.settleInput("8080");
        await pending;
    });

    it("без validates канала валидации у стока нет вовсе", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        const pending = peer.request("window.showInputBox", { handle: 5, validates: false });
        await flushMicrotasks();
        expect(sink.inputRequests[0]?.validate).toBeUndefined();
        sink.settleInput("x");
        await pending;
    });

    it("упавшая валидация расширения считает значение годным, а не вешает поле", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        peer.handleRequest("window.inputBox.validate", () => {
            throw new Error("расширение сломалось");
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
    it("список доезжает до стока, индексы — обратно расширению", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        const pending = peer.request("window.showQuickPick", {
            handle: 2,
            placeHolder: "Выберите фрукт",
            canPickMany: false,
            items: [{ label: "apple" }, { label: "banana", description: "жёлтый" }],
            picked: [],
        });
        await flushMicrotasks();
        expect(sink.pickRequests[0]).toEqual({
            handle: 2,
            placeHolder: "Выберите фрукт",
            canPickMany: false,
            items: [{ label: "apple" }, { label: "banana", description: "жёлтый" }],
            picked: [],
        });
        sink.settlePick([1]);
        await expect(pending).resolves.toEqual({ indices: [1] });
    });

    it("отмена отвечает null, пустой набор — пустым массивом", async () => {
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

    it("предотметки гасятся без canPickMany", async () => {
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

    it("без стока расширение получает «отменено» сразу", async () => {
        const { peer } = makeHost();
        await expect(peer.request("window.showQuickPick", { handle: 1, items: [], picked: [] })).resolves.toEqual({
            indices: null,
        });
    });

    it("мусорные параметры — «отменено»", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        await expect(peer.request("window.showQuickPick", { handle: 1 })).resolves.toEqual({ indices: null });
        expect(sink.pickRequests).toHaveLength(0);
    });
});

describe("ExtensionHost — window.quickInput.cancel", () => {
    it("токен расширения снимает показ через сток", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        const pending = peer.request("window.showInputBox", { handle: 4, validates: false });
        await flushMicrotasks();
        peer.notify("window.quickInput.cancel", { handle: 4 });
        await expect(pending).resolves.toEqual({ value: null });
        expect(sink.cancelled).toEqual([4]);
    });

    it("мусорная отмена до стока не доходит", async () => {
        const sink = makeSink();
        const { peer } = makeHost(sink);
        peer.notify("window.quickInput.cancel", {});
        peer.notify("window.quickInput.cancel", { handle: "нет" });
        await flushMicrotasks();
        expect(sink.cancelled).toEqual([]);
    });
});

describe("ExtensionHost — учёт живых показов", () => {
    it("закончившийся показ снимается с учёта: следующая смерть его не гасит", async () => {
        const sink = makeSink();
        const { host, peer } = makeHost(sink);
        const first = peer.request("window.showQuickPick", { handle: 21, items: [], picked: [] });
        await flushMicrotasks();
        sink.settlePick([]);
        await first;

        host.dispose();
        expect(sink.cancelled).toEqual([]);
    });

    it("несколько живых показов гасятся все", async () => {
        const sink = makeSink();
        const { host, peer } = makeHost(sink);
        void peer.request("window.showInputBox", { handle: 31, validates: false });
        void peer.request("window.showQuickPick", { handle: 32, items: [], picked: [] });
        await flushMicrotasks();

        host.dispose();
        expect([...sink.cancelled].sort((a, b) => a - b)).toEqual([31, 32]);
    });

    it("после смерти набор живых показов пуст — повторный dispose молчит", async () => {
        const sink = makeSink();
        const { host, peer } = makeHost(sink);
        void peer.request("window.showInputBox", { handle: 41, validates: false });
        await flushMicrotasks();
        host.dispose();
        expect(sink.cancelled).toEqual([41]);

        host.dispose();
        expect(sink.cancelled).toEqual([41]);
    });

    it("без стока отмена по токену никого не роняет", async () => {
        const { peer } = makeHost();
        peer.notify("window.quickInput.cancel", { handle: 1 });
        await flushMicrotasks();
        // Дошли сюда — обработчик не кинул на отсутствующем стоке.
        await expect(peer.request("window.showInputBox", { handle: 1, validates: false })).resolves.toEqual({
            value: null,
        });
    });
});

describe("ExtensionHost — смерть субпроцесса с открытым оверлеем", () => {
    it("живые показы гасятся: оверлей не остаётся на экране без хозяина", async () => {
        const sink = makeSink();
        const { host, peer } = makeHost(sink);
        void peer.request("window.showInputBox", { handle: 11, validates: false });
        await flushMicrotasks();
        expect(sink.cancelled).toEqual([]);

        host.dispose();
        expect(sink.cancelled).toEqual([11]);
    });

    it("закончившийся показ на смерти повторно не гасится", async () => {
        const sink = makeSink();
        const { host, peer } = makeHost(sink);
        const pending = peer.request("window.showInputBox", { handle: 12, validates: false });
        await flushMicrotasks();
        sink.settleInput("готово");
        await pending;

        host.dispose();
        expect(sink.cancelled).toEqual([]);
    });
});
