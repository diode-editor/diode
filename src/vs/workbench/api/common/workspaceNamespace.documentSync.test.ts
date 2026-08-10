import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

function makeCtx() {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
    };
    return { stub, ctx, workspace: createWorkspaceNamespace(ctx) };
}

const URI = "file:///proj/main.ts";

function openParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { uri: URI, languageId: "typescript", version: 1, text: "const a = 1;\n", ...overrides };
}

describe("WorkspaceNamespace — document sync (editor.didOpen)", () => {
    it("кладёт полный текст в реестр с явной версией и фаерит onDidOpenTextDocument", () => {
        const { stub, ctx, workspace } = makeCtx();
        const opened: vscode.TextDocument[] = [];
        workspace.onDidOpenTextDocument((doc) => opened.push(doc));

        stub.fire("editor.didOpen", openParams());

        expect(opened).toHaveLength(1);
        expect(opened[0].uri.toString()).toBe(URI);
        expect(opened[0].getText()).toBe("const a = 1;\n");
        expect(opened[0].version).toBe(1);
        expect(opened[0].languageId).toBe("typescript");
        // Идентичность стабильна: событие несёт тот же объект, что и реестр.
        expect(ctx.registry.get(Uri.parse(URI))).toBe(opened[0] as unknown);
        expect(workspace.textDocuments).toHaveLength(1);
    });

    it("повторный didOpen того же ресурса не дублирует событие, но обновляет текст", () => {
        const { stub, ctx, workspace } = makeCtx();
        const opened: vscode.TextDocument[] = [];
        workspace.onDidOpenTextDocument((doc) => opened.push(doc));

        stub.fire("editor.didOpen", openParams());
        stub.fire("editor.didOpen", openParams({ version: 5, text: "fresh" }));

        expect(opened).toHaveLength(1);
        const doc = ctx.registry.get(Uri.parse(URI));
        expect(doc?.getText()).toBe("fresh");
        expect(doc?.version).toBe(5);
    });

    it("невалидные параметры отбрасываются без события", () => {
        const { stub, workspace } = makeCtx();
        const opened: vscode.TextDocument[] = [];
        workspace.onDidOpenTextDocument((doc) => opened.push(doc));

        stub.fire("editor.didOpen", null);
        stub.fire("editor.didOpen", openParams({ uri: "" }));
        stub.fire("editor.didOpen", openParams({ languageId: 42 }));
        stub.fire("editor.didOpen", openParams({ version: "1" }));
        stub.fire("editor.didOpen", openParams({ text: null }));

        expect(opened).toHaveLength(0);
        expect(workspace.textDocuments).toHaveLength(0);
    });

    it("isDirty из снапшота доезжает до документа", () => {
        const { stub, ctx } = makeCtx();
        stub.fire("editor.didOpen", openParams({ isDirty: true }));
        expect(ctx.registry.get(Uri.parse(URI))?.isDirty).toBe(true);
    });
});

describe("WorkspaceNamespace — document sync (editor.didChange)", () => {
    it("фаерит onDidChangeTextDocument с одной full-range правкой старого текста", () => {
        const { stub, workspace } = makeCtx();
        const changes: vscode.TextDocumentChangeEvent[] = [];
        workspace.onDidChangeTextDocument((e) => changes.push(e));

        stub.fire("editor.didOpen", openParams({ text: "ab\ncd" }));
        stub.fire("editor.didChange", openParams({ version: 2, text: "xyz" }));

        expect(changes).toHaveLength(1);
        const event = changes[0];
        expect(event.document.getText()).toBe("xyz");
        expect(event.document.version).toBe(2);
        expect(event.reason).toBeUndefined();
        expect(event.contentChanges).toHaveLength(1);
        const change = event.contentChanges[0];
        // Диапазон покрывает ВЕСЬ старый текст ("ab\ncd" — 2 строки).
        expect(change.range.start.line).toBe(0);
        expect(change.range.start.character).toBe(0);
        expect(change.range.end.line).toBe(1);
        expect(change.range.end.character).toBe(2);
        expect(change.rangeOffset).toBe(0);
        expect(change.rangeLength).toBe(5);
        expect(change.text).toBe("xyz");
    });

    it("didChange неизвестного ресурса — это открытие: didOpen с полным текстом, а не правка", () => {
        // LSP-клиент обязан послать серверу didOpen раньше любого didChange —
        // change-событие по неанонсированному документу сервер молча отбросит.
        const { stub, workspace } = makeCtx();
        const opens: vscode.TextDocument[] = [];
        const changes: vscode.TextDocumentChangeEvent[] = [];
        workspace.onDidOpenTextDocument((doc) => opens.push(doc));
        workspace.onDidChangeTextDocument((e) => changes.push(e));

        stub.fire("editor.didChange", openParams({ version: 3, text: "new" }));

        expect(changes).toHaveLength(0);
        expect(opens).toHaveLength(1);
        expect(opens[0].getText()).toBe("new");
        expect(opens[0].version).toBe(3);
    });

    it("повторный didOpen с изменившимся текстом — didChange, а не второй didOpen", () => {
        const { stub, workspace } = makeCtx();
        const opens: vscode.TextDocument[] = [];
        const changes: vscode.TextDocumentChangeEvent[] = [];
        workspace.onDidOpenTextDocument((doc) => opens.push(doc));
        workspace.onDidChangeTextDocument((e) => changes.push(e));

        stub.fire("editor.didOpen", openParams({ version: 1, text: "old" }));
        stub.fire("editor.didOpen", openParams({ version: 2, text: "new!" }));

        expect(opens).toHaveLength(1);
        expect(changes).toHaveLength(1);
        expect(changes[0].contentChanges[0].rangeLength).toBe(3);
        expect(changes[0].document.getText()).toBe("new!");
    });

    it("невалидные параметры отбрасываются без события", () => {
        const { stub, workspace } = makeCtx();
        const changes: vscode.TextDocumentChangeEvent[] = [];
        workspace.onDidChangeTextDocument((e) => changes.push(e));

        stub.fire("editor.didChange", "junk");

        expect(changes).toHaveLength(0);
    });
});

describe("WorkspaceNamespace — document sync (editor.didClose)", () => {
    it("закрытие открытого документа фаерит onDidCloseTextDocument и ставит isClosed", () => {
        const { stub, ctx, workspace } = makeCtx();
        const closed: vscode.TextDocument[] = [];
        workspace.onDidCloseTextDocument((doc) => closed.push(doc));

        stub.fire("editor.didOpen", openParams());
        stub.fire("editor.didClose", { uri: URI });

        expect(closed).toHaveLength(1);
        expect(closed[0].isClosed).toBe(true);
        // Документ остаётся в реестре — расширения вправе держать ссылку.
        expect(ctx.registry.get(Uri.parse(URI)) === (closed[0] as unknown)).toBe(true);
    });

    it("невалидный uri и не открытый ресурс игнорируются без события", () => {
        const { stub, workspace } = makeCtx();
        const closed: vscode.TextDocument[] = [];
        workspace.onDidCloseTextDocument((doc) => closed.push(doc));

        stub.fire("editor.didClose", {});
        stub.fire("editor.didClose", { uri: 42 });
        stub.fire("editor.didClose", { uri: "" });
        // Ресурс, который никогда не открывался, — close возвращает null.
        stub.fire("editor.didClose", { uri: "file:///never-opened.ts" });

        expect(closed).toHaveLength(0);
    });

    it("после didClose повторное открытие фаерит didOpen заново (LSP-контракт)", () => {
        const { stub, workspace } = makeCtx();
        const opened: vscode.TextDocument[] = [];
        workspace.onDidOpenTextDocument((doc) => opened.push(doc));

        stub.fire("editor.didOpen", openParams());
        stub.fire("editor.didClose", { uri: URI });
        stub.fire("editor.didOpen", openParams({ version: 2 }));

        expect(opened).toHaveLength(2);
        expect(opened[1].isClosed).toBe(false);
    });
});

describe("WorkspaceNamespace — document sync (updateSubscriptions)", () => {
    function syncNotifies(stub: ReturnType<typeof makeCtx>["stub"]): unknown[] {
        return stub.notifies.filter((n) => n.method === "workspace.updateSubscriptions").map((n) => n.params);
    }

    it("подписка/отписка шлёт updateSubscriptions только на переходах 0↔1", () => {
        const { stub, workspace } = makeCtx();

        const first = workspace.onDidOpenTextDocument(() => undefined);
        expect(syncNotifies(stub)).toEqual([{ willSave: false, didSave: false, documentSync: true }]);

        // Второй подписчик (другое событие той же группы) — без новой нотификации.
        const second = workspace.onDidChangeTextDocument(() => undefined);
        expect(syncNotifies(stub)).toHaveLength(1);

        first.dispose();
        expect(syncNotifies(stub)).toHaveLength(1);

        second.dispose();
        expect(syncNotifies(stub)).toEqual([
            { willSave: false, didSave: false, documentSync: true },
            { willSave: false, didSave: false, documentSync: false },
        ]);
    });

    it("отписанный слушатель события не получает", () => {
        const { stub, workspace } = makeCtx();
        const opened: vscode.TextDocument[] = [];
        const sub = workspace.onDidOpenTextDocument((doc) => opened.push(doc));
        sub.dispose();

        stub.fire("editor.didOpen", openParams());

        expect(opened).toHaveLength(0);
    });

    it("wrapper кладётся в переданный массив disposables и dispose через него снимает подписку", () => {
        const { stub, workspace } = makeCtx();
        const disposables: vscode.Disposable[] = [];
        workspace.onDidChangeTextDocument(() => undefined, undefined, disposables);
        expect(disposables).toHaveLength(1);

        disposables[0].dispose();
        expect(syncNotifies(stub)).toEqual([
            { willSave: false, didSave: false, documentSync: true },
            { willSave: false, didSave: false, documentSync: false },
        ]);
    });
});
