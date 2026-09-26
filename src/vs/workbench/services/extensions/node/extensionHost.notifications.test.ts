import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { InMemoryClipboard } from "../../../../platform/clipboard/common/inMemoryClipboard.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { IExternalOpener } from "../../../../platform/opener/common/iExternalOpener.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";
import type { IWireShowMessageRequest } from "../../../api/common/wireTypes.ts";

import type { IExtensionHostOptions, INotificationSink } from "./extensionHost.ts";
import { ExtensionHost } from "./extensionHost.ts";

// Детерминированный in-process тест стоков `window.showMessage` и `env.*`
// (буфер обмена, внешние ссылки): installHostHandlers на in-process RPC-паре —
// тот же паттерн, что у extensionHost.quickInput.test.ts.

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

interface IStubNotificationSink extends INotificationSink {
    readonly shown: IWireShowMessageRequest[];
    readonly cleared: { count: number };
    /** Резолв висящего показа (по умолчанию сообщение висит, как тост с кнопками). */
    settle(index: number | undefined): void;
}

function makeSink(): IStubNotificationSink {
    const shown: IWireShowMessageRequest[] = [];
    const cleared = { count: 0 };
    let resolveShow: ((index: number | undefined) => void) | null = null;
    return {
        shown,
        cleared,
        show: (request) => {
            shown.push(request);
            return new Promise((resolve) => {
                resolveShow = resolve;
            });
        },
        clear: () => {
            cleared.count++;
            resolveShow?.(undefined);
        },
        settle: (index) => resolveShow?.(index),
    };
}

function makeLogger(): ILogger {
    return {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        isEnabled: () => true,
    } as unknown as ILogger;
}

function makeHost(options: Partial<IExtensionHostOptions> = {}) {
    const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, options);
    const [a, b] = createInProcessChannelPair();
    const hostRpc = new RpcEndpoint(a);
    const peer = new RpcEndpoint(b);
    (host as unknown as { installHostHandlers(rpc: RpcEndpoint): void }).installHostHandlers(hostRpc);
    return { host, peer };
}

describe("ExtensionHost — window.showMessage", () => {
    it("текст и кнопки доезжают до стока, а нажатая — обратно расширению индексом", async () => {
        const sink = makeSink();
        const { peer } = makeHost({ notificationSink: sink });
        const pending = peer.request("window.showMessage", {
            severity: "info",
            message: "Thank you for installing Supermaven!",
            items: ["Activate", "Use free version"],
        });
        await flushMicrotasks();
        expect(sink.shown[0]).toEqual({
            severity: "info",
            message: "Thank you for installing Supermaven!",
            items: ["Activate", "Use free version"],
        });
        sink.settle(1);
        await expect(pending).resolves.toEqual({ index: 1 });
    });

    it("закрытие без выбора доезжает как `index: null`", async () => {
        const sink = makeSink();
        const { peer } = makeHost({ notificationSink: sink });
        const pending = peer.request("window.showMessage", { severity: "error", message: "boom", items: ["Retry"] });
        await flushMicrotasks();
        sink.settle(undefined);
        await expect(pending).resolves.toEqual({ index: null });
    });

    it("без стока расширение получает ответ сразу, а не зависает", async () => {
        const { peer } = makeHost({});
        await expect(
            peer.request("window.showMessage", { severity: "info", message: "fyi", items: ["OK"] }),
        ).resolves.toEqual({ index: null });
    });

    it("мусорные параметры — ранний выход: сток не трогаем, журнал не пишем", async () => {
        const sink = makeSink();
        const logger = makeLogger();
        const { peer } = makeHost({ notificationSink: sink, logger });
        await expect(peer.request("window.showMessage", { severity: "info" })).resolves.toEqual({ index: null });
        expect(sink.shown).toEqual([]);
        expect(logger.info).not.toHaveBeenCalled();
    });

    it("журнал пишется уровнем строгости даже когда сообщение дошло до экрана", async () => {
        const sink = makeSink();
        const logger = makeLogger();
        const { peer } = makeHost({ notificationSink: sink, logger });
        void peer.request("window.showMessage", { severity: "error", message: "boom", items: [] });
        void peer.request("window.showMessage", { severity: "warn", message: "careful", items: [] });
        void peer.request("window.showMessage", { severity: "info", message: "fyi", items: [] });
        await flushMicrotasks();
        expect(logger.error).toHaveBeenCalledWith("[extension] boom");
        expect(logger.warn).toHaveBeenCalledWith("[extension] careful");
        expect(logger.info).toHaveBeenCalledWith("[extension] fyi");
    });

    it("смерть субпроцесса чистит сток: тост не остаётся без хозяина", async () => {
        const sink = makeSink();
        const { host, peer } = makeHost({ notificationSink: sink });
        const pending = peer.request("window.showMessage", { severity: "error", message: "boom", items: ["Retry"] });
        await flushMicrotasks();
        host.dispose();
        expect(sink.cleared.count).toBe(1);
        await expect(pending).resolves.toEqual({ index: null });
    });
});

describe("ExtensionHost — env.clipboard", () => {
    it("readText отдаёт содержимое буфера приложения", async () => {
        const clipboard = new InMemoryClipboard();
        await clipboard.writeText("из редактора");
        const { peer } = makeHost({ clipboard });
        await expect(peer.request("env.clipboard.readText", {})).resolves.toEqual({ text: "из редактора" });
    });

    it("writeText кладёт текст в тот же буфер, из которого вставляет человек", async () => {
        const clipboard = new InMemoryClipboard();
        const { peer } = makeHost({ clipboard });
        await peer.request("env.clipboard.writeText", { text: "от расширения" });
        await expect(clipboard.readText()).resolves.toBe("от расширения");
    });

    it("нестроковое значение буфер не затирает", async () => {
        const clipboard = new InMemoryClipboard();
        await clipboard.writeText("важное");
        const { peer } = makeHost({ clipboard });
        await peer.request("env.clipboard.writeText", { text: 7 });
        await expect(clipboard.readText()).resolves.toBe("важное");
    });

    it("без буфера чтение отдаёт пустую строку, запись — no-op", async () => {
        const { peer } = makeHost({});
        await expect(peer.request("env.clipboard.readText", {})).resolves.toEqual({ text: "" });
        await expect(peer.request("env.clipboard.writeText", { text: "x" })).resolves.toEqual({});
    });
});

describe("ExtensionHost — env.openExternal", () => {
    it("адрес уходит открывателю, его ответ — расширению", async () => {
        const externalOpener: IExternalOpener = { openExternal: vi.fn().mockResolvedValue(true) };
        const { peer } = makeHost({ externalOpener });
        await expect(peer.request("env.openExternal", { target: "https://example.com" })).resolves.toEqual({
            opened: true,
        });
        expect(externalOpener.openExternal).toHaveBeenCalledWith("https://example.com");
    });

    it("отказ открывателя доезжает как false", async () => {
        const externalOpener: IExternalOpener = { openExternal: vi.fn().mockResolvedValue(false) };
        const { peer } = makeHost({ externalOpener });
        await expect(peer.request("env.openExternal", { target: "https://example.com" })).resolves.toEqual({
            opened: false,
        });
    });

    it("нестроковый адрес и отсутствие открывателя — false без вызова", async () => {
        const externalOpener: IExternalOpener = { openExternal: vi.fn().mockResolvedValue(true) };
        const { peer } = makeHost({ externalOpener });
        await expect(peer.request("env.openExternal", { target: 7 })).resolves.toEqual({ opened: false });
        expect(externalOpener.openExternal).not.toHaveBeenCalled();

        const bare = makeHost({});
        await expect(bare.peer.request("env.openExternal", { target: "https://example.com" })).resolves.toEqual({
            opened: false,
        });
    });
});
