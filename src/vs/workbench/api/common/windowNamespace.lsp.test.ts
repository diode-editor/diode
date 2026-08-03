import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentRegistry } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { Uri } from "./vscodeTypes.ts";
import { createWindowNamespace, slugifyChannelName } from "./windowNamespace.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

// Наивная поверхность window, которую трогает vscode-languageclient.
// LogOutputChannel-методы обязаны писать в канал (console → stdout-логгер
// хоста): ошибки p2c.asDiagnostics клиент пишет ТОЛЬКО туда.

/** Наивная поверхность window, отсутствующая в активной части vscode.d.ts (runtime опережает декларацию). */
interface INaiveWindowSurface {
    showTextDocument(doc: unknown): Thenable<unknown>;
    tabGroups: {
        all: readonly unknown[];
        activeTabGroup: { tabs: readonly unknown[] };
        onDidChangeTabs(l: () => void): { dispose(): void };
        onDidChangeTabGroups(l: () => void): { dispose(): void };
    };
    onDidChangeVisibleTextEditors(l: () => void): { dispose(): void };
}

function makeWindow() {
    const stub = makeStubRpc();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry: new DocumentRegistry(),
        configStore: new WorkspaceConfigStore(),
    };
    const window = createWindowNamespace(ctx);
    return { stub, window, naive: window as unknown as INaiveWindowSurface };
}

describe("WindowNamespace — наивная поверхность LSP", () => {
    beforeEach(() => {
        vi.spyOn(console, "log").mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("createOutputChannel шлёт строки хосту (output.append) с уровнем и label", () => {
        const { stub, window } = makeWindow();
        const channel = window.createOutputChannel("TS (Vexx)") as unknown as {
            name: string;
            appendLine(v: string): void;
            logLevel: number;
            onDidChangeLogLevel: (l: () => void) => { dispose(): void };
            trace(v: unknown): void;
            debug(v: unknown): void;
            info(v: unknown): void;
            warn(v: unknown): void;
            error(v: unknown): void;
        };
        expect(channel.name).toBe("TS (Vexx)");
        expect(channel.logLevel).toBe(3);
        expect(() => channel.onDidChangeLogLevel(() => undefined).dispose()).not.toThrow();

        channel.appendLine("language server started");
        channel.info("converted 3 diagnostics");
        channel.error({ message: "asDiagnostics failed" });
        channel.trace("t");
        channel.debug("d");
        channel.warn("w");

        const appends = stub.notifies.filter((n) => n.method === "output.append");
        expect(appends.map((n) => n.params)).toEqual([
            { channel: "extensions.ts-vexx", label: "TS (Vexx)", level: "info", value: "language server started" },
            { channel: "extensions.ts-vexx", label: "TS (Vexx)", level: "info", value: "converted 3 diagnostics" },
            { channel: "extensions.ts-vexx", label: "TS (Vexx)", level: "error", value: '{"message":"asDiagnostics failed"}' },
            { channel: "extensions.ts-vexx", label: "TS (Vexx)", level: "trace", value: "t" },
            { channel: "extensions.ts-vexx", label: "TS (Vexx)", level: "debug", value: "d" },
            { channel: "extensions.ts-vexx", label: "TS (Vexx)", level: "warn", value: "w" },
        ]);
    });

    it("append буферизуется до перевода строки; dispose доливает остаток; show шлёт output.show", () => {
        const { stub, window } = makeWindow();
        const channel = window.createOutputChannel("Buffered");

        channel.append("partial ");
        expect(stub.notifies.filter((n) => n.method === "output.append")).toHaveLength(0);

        channel.append("line\nnext ");
        let appends = stub.notifies.filter((n) => n.method === "output.append");
        expect(appends.map((n) => (n.params as { value: string }).value)).toEqual(["partial line"]);

        // appendLine доливает накопленный хвост отдельной строкой перед своей.
        channel.appendLine("tail");
        appends = stub.notifies.filter((n) => n.method === "output.append");
        expect(appends.map((n) => (n.params as { value: string }).value)).toEqual(["partial line", "next ", "tail"]);

        channel.append("rest");
        channel.dispose();
        appends = stub.notifies.filter((n) => n.method === "output.append");
        expect(appends.at(-1)?.params).toMatchObject({ value: "rest" });

        channel.show();
        expect(stub.notifies.filter((n) => n.method === "output.show").map((n) => n.params)).toEqual([
            { channel: "extensions.buffered", label: "Buffered" },
        ]);
        // clear/replace/hide — no-op (журнал ретенционный), не бросают.
        expect(() => channel.clear()).not.toThrow();
        expect(() => channel.replace("x")).not.toThrow();
        expect(() => channel.hide()).not.toThrow();
    });

    it("slugifyChannelName: lower-case, не-алфанумерика в дефис, пустое имя — fallback", () => {
        expect(slugifyChannelName("TypeScript (Vexx)")).toBe("typescript-vexx");
        expect(slugifyChannelName("Git: log/История")).toBe("git-log");
        expect(slugifyChannelName("!!!")).toBe("channel");
    });

    it("showTextDocument резолвится активным редактором (или undefined без него)", async () => {
        const { stub, window, naive } = makeWindow();
        await expect(naive.showTextDocument({})).resolves.toBeUndefined();

        stub.fire("editor.activeEditorChanged", { uri: Uri.file("/f.ts").toString() });
        await expect(naive.showTextDocument({})).resolves.toBe(window.activeTextEditor);
    });

    it("tabGroups и onDidChangeVisibleTextEditors — валидные наивные объекты", () => {
        const { naive } = makeWindow();
        expect(naive.tabGroups.all).toEqual([]);
        expect(naive.tabGroups.activeTabGroup.tabs).toEqual([]);
        expect(() => naive.tabGroups.onDidChangeTabs(() => undefined).dispose()).not.toThrow();
        expect(() => naive.tabGroups.onDidChangeTabGroups(() => undefined).dispose()).not.toThrow();
        expect(() => naive.onDidChangeVisibleTextEditors(() => undefined).dispose()).not.toThrow();
    });
});
