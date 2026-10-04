import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";

import { type IWindowSinks, WindowCustomer } from "./windowCustomer.ts";

const NO_SINKS: IWindowSinks = {
    diagnosticsSink: undefined,
    progressSink: undefined,
    outputSink: undefined,
    statusBarItemSink: undefined,
    quickInputSink: undefined,
    notificationSink: undefined,
};

function makeSinks() {
    return {
        diagnosticsSink: vi.fn(),
        progressSink: { start: vi.fn(), report: vi.fn(), end: vi.fn() },
        outputSink: { append: vi.fn(), show: vi.fn() },
        statusBarItemSink: { update: vi.fn(), remove: vi.fn(), clear: vi.fn() },
        quickInputSink: undefined,
        notificationSink: undefined,
    };
}

/**
 * Подключает customer'а к паре in-process каналов. `rpcLogger.warn` ловит
 * исключения обработчиков нотификаций: RpcEndpoint их глотает и пишет сюда.
 */
function attach(sinks: IWindowSinks) {
    const [a, b] = createInProcessChannelPair();
    const rpcLogger = {
        trace: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        isEnabled: () => true,
    };
    const hostRpc: HostRpc = new RpcEndpoint(a, rpcLogger);
    const peer = new RpcEndpoint(b);
    const attached = new WindowCustomer(sinks).attach({ rpc: hostRpc, logger: undefined });
    return { peer, attached, rpcLogger };
}

const WINDOW_NOTIFICATIONS: readonly [string, unknown][] = [
    ["window.progress.start", { handle: 1, title: "Indexing" }],
    ["window.progress.report", { handle: 1, message: "half", increment: 50 }],
    ["window.progress.end", { handle: 1 }],
    ["output.append", { channel: "ext.log", label: "Ext", level: "info", value: "line" }],
    ["output.show", { channel: "ext.log", label: "Ext" }],
    ["window.statusBarItem.update", { handle: 2, id: "ext.item", text: "ok", alignment: "left", priority: 0 }],
    ["window.statusBarItem.dispose", { handle: 2 }],
    ["diagnostics.publish", { owner: "ext", resource: "file:///a.ts", markers: [] }],
];

describe("WindowCustomer — стоки окна", () => {
    it("валидные нотификации доходят до своих стоков", async () => {
        const sinks = makeSinks();
        const { peer, rpcLogger } = attach(sinks);

        for (const [method, params] of WINDOW_NOTIFICATIONS) peer.notify(method, params);
        await flushMicrotasks();

        expect(sinks.progressSink.start).toHaveBeenCalledWith(1, "Indexing");
        expect(sinks.progressSink.report).toHaveBeenCalledWith(1, "half", 50);
        expect(sinks.progressSink.end).toHaveBeenCalledWith(1);
        expect(sinks.outputSink.append).toHaveBeenCalledWith("ext.log", "Ext", "info", "line");
        expect(sinks.outputSink.show).toHaveBeenCalledWith("ext.log", "Ext");
        expect(sinks.statusBarItemSink.update).toHaveBeenCalledWith(expect.objectContaining({ handle: 2, text: "ok" }));
        expect(sinks.statusBarItemSink.remove).toHaveBeenCalledWith(2);
        expect(sinks.diagnosticsSink).toHaveBeenCalledWith("ext", "file:///a.ts", []);
        expect(rpcLogger.warn).not.toHaveBeenCalled();
    });

    it("мусорные параметры отбрасываются: сток не зовётся, обработчик не падает", async () => {
        const sinks = makeSinks();
        const { peer, rpcLogger } = attach(sinks);

        for (const [method] of WINDOW_NOTIFICATIONS) peer.notify(method, "мусор");
        await flushMicrotasks();

        expect(sinks.progressSink.start).not.toHaveBeenCalled();
        expect(sinks.progressSink.report).not.toHaveBeenCalled();
        expect(sinks.progressSink.end).not.toHaveBeenCalled();
        expect(sinks.outputSink.append).not.toHaveBeenCalled();
        expect(sinks.outputSink.show).not.toHaveBeenCalled();
        expect(sinks.statusBarItemSink.update).not.toHaveBeenCalled();
        expect(sinks.statusBarItemSink.remove).not.toHaveBeenCalled();
        expect(sinks.diagnosticsSink).not.toHaveBeenCalled();
        expect(rpcLogger.warn).not.toHaveBeenCalled();
    });

    it("без стоков всё молча отбрасывается — и на сообщениях, и на уходе субпроцесса", async () => {
        const { peer, attached, rpcLogger } = attach(NO_SINKS);

        // Прогресс начат и не закончен: уход субпроцесса гасит его — без стока тихо.
        peer.notify("window.progress.start", { handle: 1, title: "Indexing" });
        peer.notify("window.progress.report", { handle: 1, message: "half", increment: 50 });
        // Конец чужого прогресса — тоже без стока и без падения.
        peer.notify("window.progress.end", { handle: 9 });
        for (const [method, params] of WINDOW_NOTIFICATIONS.filter(([m]) => !m.startsWith("window.progress."))) {
            peer.notify(method, params);
        }
        await flushMicrotasks();

        expect(rpcLogger.warn).not.toHaveBeenCalled();
        expect(() => {
            attached.dispose();
        }).not.toThrow();
    });
});
