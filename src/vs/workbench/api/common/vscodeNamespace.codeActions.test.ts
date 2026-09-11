import type * as vscode from "vscode";

import { describe, expect, it, vi } from "vitest";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

// Проводка code-action-deps в ассемблере: applyCodeAction обязан ходить в
// НАСТОЯЩИЙ workspace.applyEdit (RPC до хоста) и в НАСТОЯЩИЙ commands-мост —
// юнит-тесты languagesNamespace дают фейковые deps и эту сборку не видят
// (субпроцессные интеграции не инструментируются per-test покрытием Stryker).

const PARAMS = {
    uri: "file:///proj/a.py",
    languageId: "python",
    text: "line one\n",
    range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 8 },
};

describe("VscodeNamespace — сборка code-action-deps", () => {
    it("edit-действие уходит настоящим RPC workspace.applyEdit", async () => {
        const stub = makeStubRpc();
        const ns = buildVscodeNamespace(stub.rpc).namespace;

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
        // Стаб-RPC отвечает undefined → applyEdit честно false, но сам ЗАПРОС
        // обязан уйти правильным методом и с сериализованными правками.
        expect(await stub.callRequest("languages.applyCodeAction", { id: actions[0].id })).toBe(false);
        const applyRequest = stub.requests.find((r) => r.method === "workspace.applyEdit");
        expect(applyRequest?.params).toEqual({
            edits: [
                {
                    resource: "file:///proj/a.py",
                    edits: [{ range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 4 }, text: "LINE" }],
                },
            ],
        });
    });

    it("командное действие исполняется настоящим commands-мостом (локальная команда)", async () => {
        const stub = makeStubRpc();
        const ns = buildVscodeNamespace(stub.rpc).namespace;
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
