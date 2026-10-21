import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

// languagesNamespace unit tests use fake deps — only this file sees the assembler wiring.

const SNAPSHOT = { uri: "file:///proj/a.py", languageId: "python", version: 1, text: "line one\n" };

const PARAMS = {
    handle: 0,
    uri: SNAPSHOT.uri,
    languageId: "python",
    version: 1,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 8 } },
};

describe("VscodeNamespace — сборка code-action-deps", () => {
    it("edit-действие уходит настоящим RPC workspace.applyEdit", async () => {
        const stub = makeStubRpc();
        const ns = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk()).namespace;
        stub.fire("editor.didOpen", SNAPSHOT);

        ns.languages.registerCodeActionsProvider("python", {
            provideCodeActions: (doc: vscode.TextDocument) => {
                const action = new ns.CodeAction("Fix", ns.CodeActionKind.QuickFix);
                const edit = new ns.WorkspaceEdit();
                edit.replace(doc.uri, new ns.Range(0, 0, 0, 4), "LINE");
                action.edit = edit;
                return [action];
            },
        } as unknown as vscode.CodeActionProvider);

        const actions = (await stub.callRequest("languages.provideCodeActions", PARAMS)) as { id: string }[];
        // The stub answers undefined → false; what is checked is the request itself.
        expect(await stub.callRequest("languages.applyCodeAction", { id: actions[0].id })).toBe(false);
        const applyRequest = stub.requests.find((r) => r.method === "workspace.applyEdit");
        expect(applyRequest?.params).toEqual({
            ops: [
                {
                    kind: "text",
                    resource: "file:///proj/a.py",
                    edits: [
                        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }, text: "LINE" },
                    ],
                },
            ],
            isRefactoring: true,
        });
    });

    it("командное действие исполняется настоящим commands-мостом (локальная команда)", async () => {
        const stub = makeStubRpc();
        const ns = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk()).namespace;
        stub.fire("editor.didOpen", SNAPSHOT);
        const ran = vi.fn();
        ns.commands.registerCommand("test.assembled", ran);

        ns.languages.registerCodeActionsProvider("python", {
            provideCodeActions: () => [
                { title: "Run assembled", command: "test.assembled", arguments: [7] } as unknown as vscode.CodeAction,
            ],
        } as unknown as vscode.CodeActionProvider);

        const actions = (await stub.callRequest("languages.provideCodeActions", PARAMS)) as { id: string }[];
        expect(await stub.callRequest("languages.applyCodeAction", { id: actions[0].id })).toBe(true);
        expect(ran).toHaveBeenCalledExactlyOnceWith(7);
    });
});
