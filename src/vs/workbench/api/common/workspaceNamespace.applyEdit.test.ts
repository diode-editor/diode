import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
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

function makeWorkspace() {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    const workspace = createWorkspaceNamespace(ctx);
    return { stub, workspace };
}

const URI_A = Uri.file("/proj/a.ts");
const URI_B = Uri.file("/proj/b.ts");

describe("workspace.applyEdit — RPC producer", () => {
    it("text edits go in one request, grouped by resource", async () => {
        const { stub, workspace } = makeWorkspace();
        const edit = new WorkspaceEdit();
        edit.replace(URI_A, new Range(0, 0, 0, 2), "hi");
        edit.insert(URI_A, new Position(1, 3), "x");
        edit.delete(URI_B, new Range(2, 0, 2, 5));

        const result = await workspace.applyEdit(edit as unknown as vscode.WorkspaceEdit);

        const req = stub.requests.find((r) => r.method === "workspace.applyEdit");
        expect(req?.params).toEqual({
            ops: [
                {
                    kind: "text",
                    resource: URI_A.toString(),
                    edits: [
                        {
                            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } },
                            text: "hi",
                        },
                        {
                            range: { start: { line: 1, character: 3 }, end: { line: 1, character: 3 } },
                            text: "x",
                        },
                    ],
                },
                {
                    kind: "text",
                    resource: URI_B.toString(),
                    edits: [
                        {
                            range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } },
                            text: "",
                        },
                    ],
                },
            ],
        });
        // The result is what the RPC returned (the stub answers undefined), not a literal.
        expect(result).toBeUndefined();
    });

    it("set() in [TextEdit, metadata] pair form serializes the same as the flat one", () => {
        const { stub, workspace } = makeWorkspace();
        const edit = new WorkspaceEdit();
        edit.set(URI_A, [[new TextEdit(new Range(0, 1, 0, 4), "y"), { needsConfirmation: false, label: "l" }]]);

        void workspace.applyEdit(edit as unknown as vscode.WorkspaceEdit);

        const req = stub.requests.find((r) => r.method === "workspace.applyEdit");
        expect(req?.params).toEqual({
            ops: [
                {
                    kind: "text",
                    resource: URI_A.toString(),
                    edits: [{ range: { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } }, text: "y" }],
                },
            ],
        });
    });

    it("a snippet edit lands as text with placeholders stripped", () => {
        const { stub, workspace } = makeWorkspace();
        const edit = new WorkspaceEdit();
        edit.set(URI_A, [new SnippetTextEdit(new Range(0, 0, 0, 0), new SnippetString("foo(${1:bar})$0"))]);

        void workspace.applyEdit(edit as unknown as vscode.WorkspaceEdit);

        const req = stub.requests.find((r) => r.method === "workspace.applyEdit");
        expect(req?.params).toEqual({
            ops: [
                {
                    kind: "text",
                    resource: URI_A.toString(),
                    edits: [
                        {
                            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                            text: "foo(bar)",
                        },
                    ],
                },
            ],
        });
    });

    it("an empty edit is a vacuous success without RPC", async () => {
        const { stub, workspace } = makeWorkspace();
        await expect(workspace.applyEdit(new WorkspaceEdit() as unknown as vscode.WorkspaceEdit)).resolves.toBe(true);
        expect(stub.requests).toHaveLength(0);
    });

    it("an edit of pure EOL edits only is a vacuous success without RPC", async () => {
        const { stub, workspace } = makeWorkspace();
        const edit = new WorkspaceEdit();
        edit.set(URI_A, [TextEdit.setEndOfLine(EndOfLine.CRLF)]);
        await expect(workspace.applyEdit(edit as unknown as vscode.WorkspaceEdit)).resolves.toBe(true);
        expect(stub.requests).toHaveLength(0);
    });

    it("ONLY a pure EOL edit is skipped: an empty replace and EOL with text are sent as text", () => {
        const { stub, workspace } = makeWorkspace();
        const edit = new WorkspaceEdit();
        // An empty replace WITHOUT newEol is a regular edit: the document version grows, as in VS Code.
        edit.replace(URI_A, new Range(1, 1, 1, 1), "");
        // An EOL edit carrying real text is a text edit.
        const withText = new TextEdit(new Range(0, 0, 0, 0), "x");
        withText.newEol = EndOfLine.LF;
        edit.set(URI_B, [withText]);

        void workspace.applyEdit(edit as unknown as vscode.WorkspaceEdit);

        const req = stub.requests.find((r) => r.method === "workspace.applyEdit");
        expect(req?.params).toEqual({
            ops: [
                {
                    kind: "text",
                    resource: URI_A.toString(),
                    edits: [{ range: { start: { line: 1, character: 1 }, end: { line: 1, character: 1 } }, text: "" }],
                },
                {
                    kind: "text",
                    resource: URI_B.toString(),
                    edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "x" }],
                },
            ],
        });
    });

    it("file operations are sent IN insertion ORDER interleaved with text edits", () => {
        const { stub, workspace } = makeWorkspace();
        const edit = new WorkspaceEdit();
        edit.createFile(URI_B, { contents: new TextEncoder().encode("seed\n") });
        edit.insert(URI_B, new Position(1, 0), "moved");
        edit.deleteFile(URI_A, { ignoreIfNotExists: true });

        void workspace.applyEdit(edit as unknown as vscode.WorkspaceEdit);

        const req = stub.requests.find((r) => r.method === "workspace.applyEdit");
        expect(req?.params).toEqual({
            ops: [
                { kind: "create", resource: URI_B.toString(), contents: "seed\n" },
                {
                    kind: "text",
                    resource: URI_B.toString(),
                    edits: [
                        { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, text: "moved" },
                    ],
                },
                { kind: "delete", resource: URI_A.toString(), ignoreIfNotExists: true },
            ],
        });
    });

    it("renameFile with overwrite serializes as a from/to pair plus the option", () => {
        const { stub, workspace } = makeWorkspace();
        const edit = new WorkspaceEdit();
        edit.renameFile(URI_A, URI_B, { overwrite: true });

        void workspace.applyEdit(edit as unknown as vscode.WorkspaceEdit);

        const req = stub.requests.find((r) => r.method === "workspace.applyEdit");
        expect(req?.params).toEqual({
            ops: [{ kind: "rename", from: URI_A.toString(), to: URI_B.toString(), overwrite: true }],
        });
    });

    it("each file operation option arrives separately", () => {
        const { stub, workspace } = makeWorkspace();
        const edit = new WorkspaceEdit();
        edit.createFile(URI_B, { overwrite: true, ignoreIfExists: true });
        edit.renameFile(URI_A, URI_B, { ignoreIfExists: true });

        void workspace.applyEdit(edit as unknown as vscode.WorkspaceEdit);

        const req = stub.requests.find((r) => r.method === "workspace.applyEdit");
        expect(req?.params).toEqual({
            ops: [
                { kind: "create", resource: URI_B.toString(), overwrite: true, ignoreIfExists: true },
                { kind: "rename", from: URI_A.toString(), to: URI_B.toString(), ignoreIfExists: true },
            ],
        });
    });

    it("createFile without options is sent without contents, and an edit with one file operation goes over RPC", () => {
        const { stub, workspace } = makeWorkspace();
        const edit = new WorkspaceEdit();
        edit.createFile(URI_B);

        void workspace.applyEdit(edit as unknown as vscode.WorkspaceEdit);

        const req = stub.requests.find((r) => r.method === "workspace.applyEdit");
        // Strict comparison: `contents: undefined` on the wire is not the same as
        // a missing field (the host tells them apart by `typeof === "string"`).
        expect(req?.params).toStrictEqual({ ops: [{ kind: "create", resource: URI_B.toString() }] });
    });

    it("deleteFile without options is sent without ignoreIfNotExists", () => {
        const { stub, workspace } = makeWorkspace();
        const edit = new WorkspaceEdit();
        edit.deleteFile(URI_A);

        void workspace.applyEdit(edit as unknown as vscode.WorkspaceEdit);

        const req = stub.requests.find((r) => r.method === "workspace.applyEdit");
        expect(req?.params).toEqual({ ops: [{ kind: "delete", resource: URI_A.toString() }] });
    });

    it("an operation of broken edits only gives false without RPC; a broken edit among valid ones is dropped", async () => {
        const { stub, workspace } = makeWorkspace();
        const broken = new TextEdit(new Range(0, 0, 0, 0), "bad");
        (broken as { range: unknown }).range = { line: 0 };
        const allBroken = new WorkspaceEdit();
        allBroken.set(URI_A, [broken]);
        await expect(workspace.applyEdit(allBroken as unknown as vscode.WorkspaceEdit)).resolves.toBe(false);
        expect(stub.requests.find((r) => r.method === "workspace.applyEdit")).toBeUndefined();

        const mixed = new WorkspaceEdit();
        mixed.set(URI_A, [broken, new TextEdit(new Range(0, 1, 0, 2), "ok")]);
        void workspace.applyEdit(mixed as unknown as vscode.WorkspaceEdit);
        expect(stub.requests.find((r) => r.method === "workspace.applyEdit")?.params).toEqual({
            ops: [
                {
                    kind: "text",
                    resource: URI_A.toString(),
                    edits: [
                        { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } }, text: "ok" },
                    ],
                },
            ],
        });
    });

    it("isRefactoring is sent as a flag (files.refactoring.autoSave); without it the field is absent", () => {
        const { stub, workspace } = makeWorkspace();
        const edit = new WorkspaceEdit();
        edit.insert(URI_A, new Position(0, 0), "x");

        void workspace.applyEdit(edit as unknown as vscode.WorkspaceEdit, { isRefactoring: true });
        void workspace.applyEdit(edit as unknown as vscode.WorkspaceEdit, { isRefactoring: false });
        void workspace.applyEdit(edit as unknown as vscode.WorkspaceEdit);

        const sent = stub.requests.filter((r) => r.method === "workspace.applyEdit").map((r) => r.params);
        expect(sent.map((params) => (params as { isRefactoring?: boolean }).isRefactoring)).toEqual([
            true,
            undefined,
            undefined,
        ]);
        expect(Object.keys(sent[1] as object)).toEqual(["ops"]);
    });

    it("a non-WorkspaceEdit object (bypassing types) gives false without RPC", async () => {
        const { stub, workspace } = makeWorkspace();
        await expect(workspace.applyEdit({} as unknown as vscode.WorkspaceEdit)).resolves.toBe(false);
        expect(stub.requests).toHaveLength(0);
    });
});
