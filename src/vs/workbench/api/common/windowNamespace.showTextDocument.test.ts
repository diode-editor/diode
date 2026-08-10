import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import { Range, Uri } from "./vscodeTypes.ts";
import { createWindowNamespace } from "./windowNamespace.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

/**
 * Стаб-RPC отвечает на request'ы undefined; здесь же нужен настоящий ответ
 * `editor.showTextDocument` ({uri, groupId}) — подменяем request, сохраняя
 * журнал вызовов.
 */
function makeCtx(requestResult?: unknown) {
    const stub = makeStubRpc();
    if (requestResult !== undefined) {
        (stub.rpc as unknown as { request(method: string, params: unknown): Promise<unknown> }).request = (
            method,
            params,
        ) => {
            stub.requests.push({ method, params });
            return Promise.resolve(requestResult);
        };
    }
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
    };
    return { stub, registry, window: createWindowNamespace(ctx) };
}

const A = Uri.file("/p/a.ts");
const B = Uri.file("/p/b.ts");

describe("WindowNamespace — showTextDocument (нормализация перегрузок)", () => {
    it("document + номер колонки + preserveFocus → запрос с viewColumn/preserveFocus", async () => {
        const { stub, registry, window } = makeCtx();
        const doc = registry.getOrCreate(A) as unknown as vscode.TextDocument;

        await window.showTextDocument(doc, 2, true);

        expect(stub.requests.at(-1)).toEqual({
            method: "editor.showTextDocument",
            params: { uri: A.toString(), viewColumn: 2, preserveFocus: true },
        });
    });

    it("uri + options со selection → запрос с wire-выделением", async () => {
        const { stub, window } = makeCtx();

        await window.showTextDocument(A, {
            viewColumn: -2,
            preserveFocus: false,
            selection: new Range(1, 2, 3, 4) as unknown as vscode.Range,
        });

        expect(stub.requests.at(-1)).toEqual({
            method: "editor.showTextDocument",
            params: {
                uri: A.toString(),
                viewColumn: -2,
                preserveFocus: false,
                selection: { anchorLine: 1, anchorCharacter: 2, activeLine: 3, activeCharacter: 4 },
            },
        });
    });

    it("uri без опций → запрос с одним uri", async () => {
        const { stub, window } = makeCtx();

        await window.showTextDocument(A);

        expect(stub.requests.at(-1)).toEqual({
            method: "editor.showTextDocument",
            params: { uri: A.toString() },
        });
    });

    it("ответ хоста (uri, groupId) адресует редактор конкретной группы", async () => {
        const { stub, window } = makeCtx({ uri: B.toString(), groupId: 2 });
        // Хост открыл файл в группе 2 (колонка 2) — снимок уже применён к моменту ответа.
        stub.fire("editor.layoutChanged", {
            groups: [
                {
                    groupId: 2,
                    viewColumn: 2,
                    isActive: true,
                    tabs: [{ uri: B.toString(), label: "b.ts", isActive: true, isDirty: false, kind: "text" }],
                },
            ],
        });

        const editor = await window.showTextDocument(B, { viewColumn: 2 });

        expect(editor.document.uri.toString()).toBe(B.toString());
        expect(editor.viewColumn).toBe(2);
        // Тот же редактор, что и в visibleTextEditors — идентичность по (группа, документ).
        expect(editor === window.visibleTextEditors[0]).toBe(true);
    });
});
