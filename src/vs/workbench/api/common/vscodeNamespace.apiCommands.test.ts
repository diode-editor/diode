import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";
import { Uri } from "./vscodeTypes.ts";

describe("vscode.commands: built-in editor.action.insertSnippet", () => {
    it("[api:commands.executeCommand] sends the snippet for the active editor's selection to the core", async () => {
        const stub = makeStubRpc();
        stub.responder = () => true;
        const { namespace } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());
        const uri = Uri.file("/ws/doc.md").toString();
        stub.fire("editor.activeEditorChanged", {
            uri,
            languageId: "markdown",
            isDirty: false,
            selection: { anchorLine: 0, anchorCharacter: 0, activeLine: 0, activeCharacter: 4 },
        });
        const document = namespace.window.activeTextEditor?.document as unknown as {
            applyFull(snapshot: unknown): void;
        };
        document.applyFull({ uri, text: "word", version: 3 });

        await namespace.commands.executeCommand("editor.action.insertSnippet", {
            snippet: "[$TM_SELECTED_TEXT$0](url)",
        });

        const insert = stub.requests.find((request) => request.method === "editor.insertSnippet");
        expect(insert?.params).toMatchObject({
            uri,
            version: 3,
            template: "[$TM_SELECTED_TEXT$0](url)",
            ranges: [{ start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }],
        });
    });
});

describe("vscode.commands: built-in vscode.open", () => {
    it("file Uri with a column requests editor.showTextDocument, not commands.executeCommand", async () => {
        const stub = makeStubRpc();
        const { namespace } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());

        await namespace.commands.executeCommand("vscode.open", Uri.file("/ws/greet_test.go"), 2);

        expect(stub.requests).toEqual([
            { method: "editor.showTextDocument", params: { uri: "file:///ws/greet_test.go", viewColumn: 2 } },
        ]);
    });

    it("[api:window.showTextDocument] the public show of a missing file rejects from opening it, unlike vscode.open", async () => {
        const stub = makeStubRpc();
        const { namespace } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());

        await expect(namespace.window.showTextDocument(Uri.file("/ws/greet_test.go"))).rejects.toThrow("ENOENT");

        expect(stub.requests.map((request) => request.method)).not.toContain("editor.showTextDocument");
    });

    it("https link requests env.openExternal", async () => {
        const stub = makeStubRpc();
        stub.responder = () => ({ opened: true });
        const { namespace } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());

        await namespace.commands.executeCommand("vscode.open", "https://github.com/golang/tools");

        expect(stub.requests).toEqual([
            { method: "env.openExternal", params: { uri: "https://github.com/golang/tools" } },
        ]);
    });
});
