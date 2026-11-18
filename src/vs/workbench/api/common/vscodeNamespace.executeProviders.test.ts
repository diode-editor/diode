import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";
import { CodeAction, CompletionItem, Hover, MarkdownString, Position, Range, Uri } from "./vscodeTypes.ts";

describe("API commands and documents in the composed vscode namespace", () => {
    let dir: string;
    let file: Uri;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "diode-api-commands-"));
        writeFileSync(join(dir, "a.json"), "{}\n");
        file = Uri.file(join(dir, "a.json"));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    function setup() {
        const stub = makeStubRpc();
        stub.responder = (method) =>
            method === "languages.getLanguageOfDocument" ? { languageId: "json" } : undefined;
        const { namespace } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());
        return { stub, vscode: namespace };
    }

    it("[api:languages.registerCompletionItemProvider] vscode.executeCompletionItemProvider reaches a provider on a file nobody opened", async () => {
        const { vscode: api } = setup();
        api.languages.registerCompletionItemProvider({ language: "json" }, {
            provideCompletionItems: () => [new CompletionItem("foo")],
        } as unknown as vscode.CompletionItemProvider);

        const list = await api.commands.executeCommand<vscode.CompletionList>(
            "vscode.executeCompletionItemProvider",
            file,
            new Position(0, 0),
        );

        expect(list.items.map((item) => item.label)).toEqual(["foo"]);
    });

    it("[api:languages.registerCodeActionsProvider] vscode.executeCodeActionProvider reaches a provider on a file nobody opened", async () => {
        const { vscode: api } = setup();
        const action = new CodeAction("fix");
        api.languages.registerCodeActionsProvider({ language: "json" }, {
            provideCodeActions: () => [action],
        } as unknown as vscode.CodeActionProvider);

        await expect(
            api.commands.executeCommand("vscode.executeCodeActionProvider", file, new Range(0, 0, 0, 1)),
        ).resolves.toEqual([action]);
    });

    it("[api:languages.registerHoverProvider] vscode.executeHoverProvider reaches a provider on a file nobody opened", async () => {
        const { vscode: api } = setup();
        api.languages.registerHoverProvider({ language: "json" }, { provideHover: () => new Hover("doc") });

        const hovers = await api.commands.executeCommand<vscode.Hover[]>(
            "vscode.executeHoverProvider",
            file,
            new Position(0, 0),
        );

        expect(hovers).toEqual([new Hover([new MarkdownString("doc")], new Range(0, 0, 0, 0))]);
    });

    it("[api:workspace.registerTextDocumentContentProvider] vscode.executeHoverProvider works on a content-provider scheme", async () => {
        const { vscode: api } = setup();
        api.workspace.registerTextDocumentContentProvider("embedded", {
            provideTextDocumentContent: () => "<p>{{ title }}</p>",
        });
        const seen: string[] = [];
        api.languages.registerHoverProvider(
            { scheme: "embedded" },
            {
                provideHover: (document, position) => {
                    seen.push(document.getText(document.getWordRangeAtPosition(position)));
                    return new Hover("from html", new Range(0, 6, 0, 11));
                },
            },
        );

        const hovers = await api.commands.executeCommand<vscode.Hover[]>(
            "vscode.executeHoverProvider",
            Uri.parse("embedded:/app.html"),
            new Position(0, 7),
        );

        expect(seen).toEqual(["title"]);
        expect(hovers.map((hover) => hover.contents)).toEqual([[new MarkdownString("from html")]]);
    });

    it("vscode.open goes on working next to them", async () => {
        const { stub, vscode: api } = setup();

        await api.commands.executeCommand("vscode.open", file);

        expect(stub.requests.some((request) => request.method === "editor.showTextDocument")).toBe(true);
    });

    it("[api:window.showWorkspaceFolderPick] sees the folders of the workspace", async () => {
        const { stub, vscode: api } = setup();
        stub.fire("workspace.initialize", { workspaceFolders: [{ uri: file.toString(), name: "one", index: 0 }] });
        stub.responder = (method) => (method === "window.showQuickPick" ? { indices: [0] } : undefined);

        const picked = await api.window.showWorkspaceFolderPick();

        expect(picked?.name).toBe("one");
    });

    it("a file without a model has the language of the host; without an answer it stays plaintext", async () => {
        const { stub, vscode: api } = setup();

        expect((await api.workspace.openTextDocument(file)).languageId).toBe("json");

        stub.responder = null;
        expect((await api.workspace.openTextDocument(file)).languageId).toBe("plaintext");
    });
});
