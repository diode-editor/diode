import type * as vscode from "vscode";

import { describe, expect, it } from "vitest";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import type { IVscodeHostContext } from "./vscodeHostContext.ts";
import {
    EndOfLine,
    Position,
    Range,
    SnippetString,
    SnippetTextEdit,
    TextEdit,
    Uri,
    WorkspaceEdit,
} from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";
import { createWorkspaceNamespace } from "./workspaceNamespace.ts";

// Продюсер RPC `workspace.applyEdit`: кто, когда и с каким payload'ом шлёт
// запрос хосту — и в каких случаях честно отвечает сам, не отправляя ничего.

function makeWorkspace() {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
    };
    const workspace = createWorkspaceNamespace(ctx);
    return { stub, workspace };
}

const URI_A = Uri.file("/proj/a.ts");
const URI_B = Uri.file("/proj/b.ts");

describe("workspace.applyEdit — продюсер RPC", () => {
    it("текстовые правки уезжают одним запросом, сгруппированные по ресурсам", async () => {
        const { stub, workspace } = makeWorkspace();
        const edit = new WorkspaceEdit();
        edit.replace(URI_A, new Range(0, 0, 0, 2), "hi");
        edit.insert(URI_A, new Position(1, 3), "x");
        edit.delete(URI_B, new Range(2, 0, 2, 5));

        const result = await workspace.applyEdit(edit as unknown as vscode.WorkspaceEdit);

        const req = stub.requests.find((r) => r.method === "workspace.applyEdit");
        expect(req?.params).toEqual({
            edits: [
                {
                    resource: URI_A.toString(),
                    edits: [
                        {
                            range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 2 },
                            text: "hi",
                        },
                        {
                            range: { startLine: 1, startCharacter: 3, endLine: 1, endCharacter: 3 },
                            text: "x",
                        },
                    ],
                },
                {
                    resource: URI_B.toString(),
                    edits: [
                        {
                            range: { startLine: 2, startCharacter: 0, endLine: 2, endCharacter: 5 },
                            text: "",
                        },
                    ],
                },
            ],
        });
        // Ответ — то, что вернул RPC (стаб отвечает undefined), а не литерал.
        expect(result).toBeUndefined();
    });

    it("set() в форме пар [TextEdit, metadata] сериализуется так же, как плоская", () => {
        const { stub, workspace } = makeWorkspace();
        const edit = new WorkspaceEdit();
        edit.set(URI_A, [[new TextEdit(new Range(0, 1, 0, 4), "y"), { needsConfirmation: false, label: "l" }]]);

        void workspace.applyEdit(edit as unknown as vscode.WorkspaceEdit);

        const req = stub.requests.find((r) => r.method === "workspace.applyEdit");
        expect(req?.params).toEqual({
            edits: [
                {
                    resource: URI_A.toString(),
                    edits: [{ range: { startLine: 0, startCharacter: 1, endLine: 0, endCharacter: 4 }, text: "y" }],
                },
            ],
        });
    });

    it("сниппет-правка приземляется текстом с вырезанными плейсхолдерами", () => {
        const { stub, workspace } = makeWorkspace();
        const edit = new WorkspaceEdit();
        edit.set(URI_A, [new SnippetTextEdit(new Range(0, 0, 0, 0), new SnippetString("foo(${1:bar})$0"))]);

        void workspace.applyEdit(edit as unknown as vscode.WorkspaceEdit);

        const req = stub.requests.find((r) => r.method === "workspace.applyEdit");
        expect(req?.params).toEqual({
            edits: [
                {
                    resource: URI_A.toString(),
                    edits: [{ range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 }, text: "foo(bar)" }],
                },
            ],
        });
    });

    it("пустой edit — вакуумный успех без RPC", async () => {
        const { stub, workspace } = makeWorkspace();
        await expect(workspace.applyEdit(new WorkspaceEdit() as unknown as vscode.WorkspaceEdit)).resolves.toBe(true);
        expect(stub.requests).toHaveLength(0);
    });

    it("edit из одних чистых EOL-правок — вакуумный успех без RPC", async () => {
        const { stub, workspace } = makeWorkspace();
        const edit = new WorkspaceEdit();
        edit.set(URI_A, [TextEdit.setEndOfLine(EndOfLine.CRLF)]);
        await expect(workspace.applyEdit(edit as unknown as vscode.WorkspaceEdit)).resolves.toBe(true);
        expect(stub.requests).toHaveLength(0);
    });

    it("пропускается ТОЛЬКО чистая EOL-правка: пустая замена и EOL с текстом едут как текст", () => {
        const { stub, workspace } = makeWorkspace();
        const edit = new WorkspaceEdit();
        // Пустая замена пустого диапазона БЕЗ newEol — обычная правка, не EOL:
        // хост должен её получить (как VS Code — версия документа растёт).
        edit.replace(URI_A, new Range(1, 1, 1, 1), "");
        // EOL-правка, к которой приклеен настоящий текст, — текстовая.
        const withText = new TextEdit(new Range(0, 0, 0, 0), "x");
        withText.newEol = EndOfLine.LF;
        edit.set(URI_B, [withText]);

        void workspace.applyEdit(edit as unknown as vscode.WorkspaceEdit);

        const req = stub.requests.find((r) => r.method === "workspace.applyEdit");
        expect(req?.params).toEqual({
            edits: [
                {
                    resource: URI_A.toString(),
                    edits: [{ range: { startLine: 1, startCharacter: 1, endLine: 1, endCharacter: 1 }, text: "" }],
                },
                {
                    resource: URI_B.toString(),
                    edits: [{ range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 }, text: "x" }],
                },
            ],
        });
    });

    it("файловые операции не поддержаны: честный false без RPC, текст не применяется", async () => {
        const { stub, workspace } = makeWorkspace();
        const edit = new WorkspaceEdit();
        edit.replace(URI_A, new Range(0, 0, 0, 1), "z");
        edit.renameFile();
        await expect(workspace.applyEdit(edit as unknown as vscode.WorkspaceEdit)).resolves.toBe(false);
        expect(stub.requests).toHaveLength(0);
    });

    it("объект не-WorkspaceEdit (мимо типов) — честный false без RPC", async () => {
        const { stub, workspace } = makeWorkspace();
        await expect(workspace.applyEdit({} as unknown as vscode.WorkspaceEdit)).resolves.toBe(false);
        expect(stub.requests).toHaveLength(0);
    });
});
