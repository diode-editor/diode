import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentRegistry } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { Uri } from "./vscodeTypes.ts";
import { createWindowNamespace } from "./windowNamespace.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

// Наивная поверхность window, которую трогает vscode-languageclient.
// LogOutputChannel-методы обязаны писать в канал (console → stdout-логгер
// хоста): ошибки p2c.asDiagnostics клиент пишет ТОЛЬКО туда.

function makeWindow() {
    const stub = makeStubRpc();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry: new DocumentRegistry(),
        configStore: new WorkspaceConfigStore(),
    };
    return { stub, window: createWindowNamespace(ctx) };
}

describe("WindowNamespace — наивная поверхность LSP", () => {
    beforeEach(() => {
        vi.spyOn(console, "log").mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("createOutputChannel даёт LogOutputChannel-методы, пишущие в канал", () => {
        const { window } = makeWindow();
        const channel = window.createOutputChannel("TS (Vexx)") as unknown as {
            logLevel: number;
            onDidChangeLogLevel: (l: () => void) => { dispose(): void };
            trace(v: unknown): void;
            debug(v: unknown): void;
            info(v: unknown): void;
            warn(v: unknown): void;
            error(v: unknown): void;
        };
        expect(channel.logLevel).toBe(3);
        expect(() => channel.onDidChangeLogLevel(() => undefined).dispose()).not.toThrow();

        channel.info("converted 3 diagnostics");
        channel.error({ message: "asDiagnostics failed" });
        channel.trace("t");
        channel.debug("d");
        channel.warn("w");

        expect(console.log).toHaveBeenCalledWith("[TS (Vexx)] converted 3 diagnostics");
        expect(console.log).toHaveBeenCalledWith('[TS (Vexx)] {"message":"asDiagnostics failed"}');
        expect(console.log).toHaveBeenCalledTimes(5);
    });

    it("withProgress исполняет задачу с no-op прогрессом и не-отменённым токеном", async () => {
        const { window } = makeWindow();
        const result = await window.withProgress({ location: 15 } as never, (progress, token) => {
            progress.report({ message: "indexing" });
            expect(token.isCancellationRequested).toBe(false);
            expect(() => token.onCancellationRequested(() => undefined)).not.toThrow();
            return Promise.resolve(42);
        });
        expect(result).toBe(42);
    });

    it("showTextDocument резолвится активным редактором (или undefined без него)", async () => {
        const { stub, window } = makeWindow();
        await expect(window.showTextDocument({} as never)).resolves.toBeUndefined();

        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/f.ts").toString() });
        await expect(window.showTextDocument({} as never)).resolves.toBe(window.activeTextEditor);
    });

    it("tabGroups и onDidChangeVisibleTextEditors — валидные наивные объекты", () => {
        const { window } = makeWindow();
        expect(window.tabGroups.all).toEqual([]);
        expect(window.tabGroups.activeTabGroup.tabs).toEqual([]);
        expect(() => window.tabGroups.onDidChangeTabs(() => undefined).dispose()).not.toThrow();
        expect(() => window.tabGroups.onDidChangeTabGroups(() => undefined).dispose()).not.toThrow();
        expect(() => window.onDidChangeVisibleTextEditors(() => undefined).dispose()).not.toThrow();
    });
});
