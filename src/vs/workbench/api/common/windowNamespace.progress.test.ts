import { describe, expect, it } from "vitest";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { ProgressLocation } from "./vscodeTypes.ts";
import { createWindowNamespace } from "./windowNamespace.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

// Настоящий window.withProgress: жизненный цикл уезжает хосту нотификациями
// window.progress.{start,report,end}; хост рисует спиннер в статус-баре.

function makeWindow() {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
    };
    return { stub, window: createWindowNamespace(ctx) };
}

function progressNotifies(stub: ReturnType<typeof makeWindow>["stub"]): { method: string; params: unknown }[] {
    return stub.notifies.filter((n) => n.method.startsWith("window.progress."));
}

describe("WindowNamespace — window.withProgress (настоящий)", () => {
    it("start → report'ы → end; результат задачи возвращается", async () => {
        const { stub, window } = makeWindow();

        const result = await window.withProgress(
            { location: ProgressLocation.Window as never, title: "TS: starting" },
            (progress, token) => {
                expect(token.isCancellationRequested).toBe(false);
                progress.report({ message: "loading project" });
                progress.report({ increment: 30 });
                progress.report({ message: "indexing", increment: 20 });
                return Promise.resolve(42);
            },
        );

        expect(result).toBe(42);
        expect(progressNotifies(stub)).toEqual([
            { method: "window.progress.start", params: { handle: 1, title: "TS: starting" } },
            { method: "window.progress.report", params: { handle: 1, message: "loading project" } },
            { method: "window.progress.report", params: { handle: 1, increment: 30 } },
            { method: "window.progress.report", params: { handle: 1, message: "indexing", increment: 20 } },
            { method: "window.progress.end", params: { handle: 1 } },
        ]);
    });

    it("reject задачи: end всё равно уходит, ошибка пробрасывается", async () => {
        const { stub, window } = makeWindow();

        await expect(
            window.withProgress({ location: ProgressLocation.Window as never, title: "boom" }, () =>
                Promise.reject(new Error("failed")),
            ),
        ).rejects.toThrow("failed");

        expect(progressNotifies(stub).map((n) => n.method)).toEqual([
            "window.progress.start",
            "window.progress.end",
        ]);
    });

    it("handle уникален per-вызов; без title уезжает пустая строка", async () => {
        const { stub, window } = makeWindow();
        await window.withProgress({ location: ProgressLocation.Window as never, title: "a" }, () =>
            Promise.resolve(1),
        );
        await window.withProgress({ location: ProgressLocation.Window as never }, () => Promise.resolve(2));

        const starts = progressNotifies(stub).filter((n) => n.method === "window.progress.start");
        expect(starts).toEqual([
            { method: "window.progress.start", params: { handle: 1, title: "a" } },
            { method: "window.progress.start", params: { handle: 2, title: "" } },
        ]);
    });

    it("мусорные report-значения отбрасываются пополя", async () => {
        const { stub, window } = makeWindow();
        await window.withProgress({ location: ProgressLocation.Window as never, title: "t" }, (progress) => {
            progress.report(null as never);
            progress.report({ message: 42, increment: "x" } as never);
            progress.report({ increment: Number.NaN } as never);
            return Promise.resolve(0);
        });

        const reports = progressNotifies(stub).filter((n) => n.method === "window.progress.report");
        // Кривые поля выпали — конверт остаётся валидным (только handle).
        expect(reports).toEqual([
            { method: "window.progress.report", params: { handle: 1 } },
            { method: "window.progress.report", params: { handle: 1 } },
            { method: "window.progress.report", params: { handle: 1 } },
        ]);
    });
});
