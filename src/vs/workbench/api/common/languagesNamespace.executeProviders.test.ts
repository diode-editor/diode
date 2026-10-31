import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker, type ExtHostTextDocument } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import {
    CodeAction,
    CodeActionKind,
    CompletionItem,
    CompletionList,
    Diagnostic,
    Position,
    Range,
    Uri,
    WorkspaceEdit,
} from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

function setup() {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const documentSync = new DocumentSyncTracker(registry);
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync,
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    const { languages, executeProviders } = createLanguagesNamespace(ctx);
    const doc = documentSync.open({ uri: "file:///ws/a.json", text: "{}\n", languageId: "json" });
    return { stub, languages, executeProviders, doc, documentSync };
}

const AT = new Position(0, 0) as unknown as vscode.Position;
const RANGE = new Range(0, 0, 0, 2) as unknown as vscode.Range;

function completions(result: unknown): vscode.CompletionItemProvider {
    return { provideCompletionItems: () => result } as unknown as vscode.CompletionItemProvider;
}

function actions(result: unknown, resolve?: (action: vscode.CodeAction) => unknown): vscode.CodeActionProvider {
    return {
        provideCodeActions: () => result,
        ...(resolve !== undefined ? { resolveCodeAction: resolve } : {}),
    } as unknown as vscode.CodeActionProvider;
}

describe("vscode.executeCompletionItemProvider", () => {
    it("[api:languages.registerCompletionItemProvider] asks the matching providers only, best selector first, and returns their items", async () => {
        const { languages, executeProviders, doc } = setup();
        languages.registerCompletionItemProvider("*", completions([new CompletionItem("any language")]));
        languages.registerCompletionItemProvider(
            { language: "json" },
            completions([new CompletionItem("by language")]),
        );
        const foreign = vi.fn(() => [new CompletionItem("python")]);
        languages.registerCompletionItemProvider({ language: "python" }, {
            provideCompletionItems: foreign,
        } as unknown as vscode.CompletionItemProvider);

        const list = await executeProviders.completionItems(doc, AT, undefined, undefined);

        expect(list.items.map((item) => item.label)).toEqual(["by language", "any language"]);
        expect(list.isIncomplete).toBe(false);
        expect(foreign).not.toHaveBeenCalled();
    });

    it("passes the position and an Invoke context; a trigger character makes it a TriggerCharacter one", async () => {
        const { languages, executeProviders, doc } = setup();
        const seen: unknown[][] = [];
        languages.registerCompletionItemProvider("json", {
            provideCompletionItems: (_doc: unknown, position: unknown, _token: unknown, context: unknown) => {
                seen.push([position, context]);
                return [];
            },
        } as unknown as vscode.CompletionItemProvider);

        await executeProviders.completionItems(doc, AT, undefined, undefined);
        await executeProviders.completionItems(doc, AT, ".", undefined);

        expect(seen[0]).toEqual([AT, { triggerKind: 0, triggerCharacter: undefined }]);
        expect(seen[1]).toEqual([AT, { triggerKind: 1, triggerCharacter: "." }]);
    });

    it("one incomplete list makes the result incomplete; a failing provider does not hide the others", async () => {
        const { languages, executeProviders, doc } = setup();
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        languages.registerCompletionItemProvider("json", {
            provideCompletionItems: () => {
                throw new Error("boom");
            },
        } as unknown as vscode.CompletionItemProvider);
        languages.registerCompletionItemProvider(
            "json",
            completions(new CompletionList([new CompletionItem("kept")], true)),
        );
        languages.registerCompletionItemProvider("json", completions(new CompletionList([], false)));

        const list = await executeProviders.completionItems(doc, AT, undefined, undefined);

        expect(list.items.map((item) => item.label)).toEqual(["kept"]);
        expect(list.isIncomplete).toBe(true);
        error.mockRestore();
    });

    it("itemResolveCount resolves exactly that many items", async () => {
        const { languages, executeProviders, doc } = setup();
        const resolve = vi.fn((item: CompletionItem) => {
            item.detail = "resolved";
            return item;
        });
        languages.registerCompletionItemProvider("json", {
            provideCompletionItems: () => [new CompletionItem("a"), new CompletionItem("b")],
            resolveCompletionItem: resolve,
        } as unknown as vscode.CompletionItemProvider);

        const none = await executeProviders.completionItems(doc, AT, undefined, undefined);
        expect(resolve).not.toHaveBeenCalled();
        expect(none.items[0].detail).toBeUndefined();

        const list = await executeProviders.completionItems(doc, AT, undefined, 1);

        expect(resolve).toHaveBeenCalledTimes(1);
        expect(list.items.map((item) => item.detail)).toEqual(["resolved", undefined]);
    });

    it("a resolve that answers nothing keeps the item; a provider without resolve is fine", async () => {
        const { languages, executeProviders, doc } = setup();
        const item = new CompletionItem("a");
        languages.registerCompletionItemProvider("json", {
            provideCompletionItems: () => [item],
            resolveCompletionItem: () => undefined,
        } as unknown as vscode.CompletionItemProvider);
        languages.registerCompletionItemProvider("json", completions([new CompletionItem("b")]));

        const list = await executeProviders.completionItems(doc, AT, undefined, 2);

        expect(list.items[0]).toBe(item);
        expect(list.items.map((i) => i.label)).toEqual(["a", "b"]);
    });
});

describe("vscode.executeCodeActionProvider", () => {
    it("[api:languages.registerCodeActionsProvider] hands the provider the very diagnostics in range and returns actions and commands as they are", async () => {
        const { languages, executeProviders, doc } = setup();
        const inRange = new Diagnostic(new Range(0, 0, 0, 1), "here");
        const outside = new Diagnostic(new Range(5, 0, 5, 1), "there");
        languages.createDiagnosticCollection().set(doc.uri, [inRange, outside]);
        const action = new CodeAction("fix", CodeActionKind.QuickFix);
        const command = { title: "run", command: "x.run" };
        let context: vscode.CodeActionContext | undefined;
        languages.registerCodeActionsProvider("json", {
            provideCodeActions: (_doc: unknown, _range: unknown, ctx: vscode.CodeActionContext) => {
                context = ctx;
                return [action, command, null];
            },
        } as unknown as vscode.CodeActionProvider);
        languages.registerCodeActionsProvider({ language: "python" }, actions([new CodeAction("foreign")]));

        const result = await executeProviders.codeActions(doc, RANGE, undefined, undefined);

        expect(result).toEqual([action, command]);
        expect(result[0]).toBe(action);
        expect(context?.diagnostics[0]).toBe(inRange);
        expect(context?.diagnostics).toHaveLength(1);
        expect(context?.only).toBeUndefined();
        expect(context?.triggerKind).toBe(1);
    });

    it("a kind keeps only the actions under it and drops bare commands", async () => {
        const { languages, executeProviders, doc } = setup();
        const quickFix = new CodeAction("fix", CodeActionKind.QuickFix);
        languages.registerCodeActionsProvider(
            "json",
            actions([
                quickFix,
                new CodeAction("refactor", CodeActionKind.Refactor),
                new CodeAction("no kind"),
                { title: "cmd", command: "c" },
            ]),
        );

        const result = await executeProviders.codeActions(doc, RANGE, "quickfix", undefined);

        expect(result).toEqual([quickFix]);
    });

    it("a provider that fails or answers with no array adds nothing", async () => {
        const { languages, executeProviders, doc } = setup();
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        languages.registerCodeActionsProvider("json", {
            provideCodeActions: () => {
                throw new Error("boom");
            },
        } as unknown as vscode.CodeActionProvider);
        languages.registerCodeActionsProvider("json", actions(undefined));
        const kept = new CodeAction("kept");
        languages.registerCodeActionsProvider("json", actions([kept]));

        expect(await executeProviders.codeActions(doc, RANGE, undefined, undefined)).toEqual([kept]);
        error.mockRestore();
    });

    it("itemResolveCount resolves actions without an edit, up to the count", async () => {
        const { languages, executeProviders, doc } = setup();
        const hasEdit = new CodeAction("has edit");
        hasEdit.edit = new WorkspaceEdit();
        const lazy = new CodeAction("lazy");
        const beyond = new CodeAction("beyond");
        const resolved = new CodeAction("resolved");
        const resolve = vi.fn(() => resolved);
        languages.registerCodeActionsProvider("json", actions([hasEdit, lazy, beyond], resolve));

        const untouched = await executeProviders.codeActions(doc, RANGE, undefined, undefined);
        expect(untouched).toEqual([hasEdit, lazy, beyond]);
        expect(resolve).not.toHaveBeenCalled();

        const result = await executeProviders.codeActions(doc, RANGE, undefined, 2);

        expect(result).toEqual([hasEdit, resolved, beyond]);
        expect(resolve).toHaveBeenCalledTimes(1);
    });

    it("a resolve answering nothing keeps the action; a bare command is never resolved", async () => {
        const { languages, executeProviders, doc } = setup();
        const lazy = new CodeAction("lazy");
        const command = { title: "cmd", command: "c" };
        const resolve = vi.fn(() => undefined);
        languages.registerCodeActionsProvider("json", actions([command, lazy], resolve));

        expect(await executeProviders.codeActions(doc, RANGE, undefined, 5)).toEqual([command, lazy]);
        expect(resolve).toHaveBeenCalledTimes(1);
    });
});

describe("languages — language of a document", () => {
    it("[api:languages.getLanguages] returns the list of the host as a fresh array", async () => {
        const { stub, languages } = setup();
        const hostList = ["plaintext", "json"];
        stub.responder = (method) => (method === "languages.getLanguages" ? hostList : undefined);

        const result = await languages.getLanguages();

        expect(result).toEqual(hostList);
        expect(result).not.toBe(hostList);
    });

    it("[api:languages.setTextDocumentLanguage] a model in the core: its didClose/didOpen do the work, nothing fires here", async () => {
        const { stub, languages, doc, documentSync } = setup();
        stub.responder = () => ({ applied: true });
        const changeLanguage = vi.spyOn(documentSync, "changeLanguage");

        const result = await languages.setTextDocumentLanguage(doc, "python");

        expect(result).toBe(doc);
        expect(changeLanguage).not.toHaveBeenCalled();
        expect(stub.requests).toContainEqual({
            method: "languages.changeLanguage",
            params: { uri: doc.uri.toString(), languageId: "python" },
        });
    });

    it("[api:languages.setTextDocumentLanguage] no model in the core: close and open fire here, and the document has the new language", async () => {
        const { stub, languages, doc, documentSync } = setup();
        stub.responder = () => ({ applied: false });
        const events: string[] = [];
        documentSync.onDidCloseEmitter.event((d: ExtHostTextDocument) => events.push(`close ${d.languageId}`));
        documentSync.onDidOpenEmitter.event((d: ExtHostTextDocument) => events.push(`open ${d.languageId}`));

        await languages.setTextDocumentLanguage(doc, "python");

        expect(events).toEqual(["close json", "open python"]);
        expect(doc.languageId).toBe("python");
    });

    it("an unknown language rejects and the document stays as it was", async () => {
        const { stub, languages, doc } = setup();
        (stub.rpc as unknown as { request: () => Promise<unknown> }).request = () =>
            Promise.reject(new Error("Unknown language id: nope"));

        await expect(languages.setTextDocumentLanguage(doc, "nope")).rejects.toThrow("Unknown language id: nope");

        expect(doc.languageId).toBe("json");
    });
});

describe("matching uses the document's uri", () => {
    it("a scheme selector sees the scheme", async () => {
        const { languages, executeProviders, documentSync } = setup();
        const virtual = documentSync.open({ uri: Uri.parse("ttt:path.far").toString(), text: "x" });
        languages.registerCompletionItemProvider(
            { scheme: "ttt", pattern: "*.far" },
            completions([new CompletionItem("far")]),
        );

        const list = await executeProviders.completionItems(virtual, AT, undefined, undefined);

        expect(list.items.map((item) => item.label)).toEqual(["far"]);
    });
});
