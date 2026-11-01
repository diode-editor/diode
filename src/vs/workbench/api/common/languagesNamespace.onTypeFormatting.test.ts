import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Range, TextEdit } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

const URI = "file:///proj/Main.java";
const METHOD = "languages.provideOnTypeFormattingEdits";

function makeCtx(): { stub: IStubRpc; languages: typeof vscode.languages } {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry, () => undefined),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    const { languages } = createLanguagesNamespace(ctx, {
        applyEdit: () => Promise.resolve(true),
        executeCommand: () => Promise.resolve(undefined),
        hasCommand: () => Promise.resolve(false),
    });
    ctx.documentSync.open({ uri: URI, languageId: "java", version: 1, text: "int x=1;\n" });
    return { stub, languages };
}

function params(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        handle: 0,
        uri: URI,
        languageId: "java",
        version: 1,
        line: 0,
        character: 8,
        ch: ";",
        tabSize: 2,
        insertSpaces: false,
        ...overrides,
    };
}

function register(languages: typeof vscode.languages, answer: () => unknown): void {
    languages.registerOnTypeFormattingEditProvider(
        "java",
        { provideOnTypeFormattingEdits: answer as vscode.OnTypeFormattingEditProvider["provideOnTypeFormattingEdits"] },
        ";",
    );
}

describe("LanguagesNamespace — registerOnTypeFormattingEditProvider", () => {
    it("the first and the other trigger characters go to the core with the registration, dispose removes it", () => {
        const { stub, languages } = makeCtx();
        languages
            .registerOnTypeFormattingEditProvider(
                "java",
                { provideOnTypeFormattingEdits: () => undefined },
                ";",
                "\n",
                "}",
            )
            .dispose();
        expect(stub.notifies.filter((n) => n.method.startsWith("languages."))).toEqual([
            {
                method: "languages.register",
                params: {
                    handle: 0,
                    kind: "onTypeFormatting",
                    selector: [{ language: "java" }],
                    triggerCharacters: [";", "\n", "}"],
                },
            },
            { method: "languages.unregister", params: { handle: 0 } },
        ]);
    });

    it("the provider gets the document, the position, the character and the options", async () => {
        const { stub, languages } = makeCtx();
        const provide = vi.fn<
            (
                document: vscode.TextDocument,
                position: vscode.Position,
                ch: string,
                options: vscode.FormattingOptions,
            ) => unknown
        >(() => undefined);
        register(languages, provide as never);
        await stub.callRequest(METHOD, params());

        const [document, position, ch, options] = provide.mock.calls[0];
        expect(document.uri.toString()).toBe(URI);
        expect({ line: position.line, character: position.character }).toEqual({ line: 0, character: 8 });
        expect(ch).toBe(";");
        expect(options).toEqual({ tabSize: 2, insertSpaces: false });
    });

    it("edits go over the wire, what is not an edit is dropped", async () => {
        const { stub, languages } = makeCtx();
        register(languages, () => [new TextEdit(new Range(0, 5, 0, 6), " = "), { nonsense: true }]);
        expect(await stub.callRequest(METHOD, params())).toEqual([
            { range: { start: { line: 0, character: 5 }, end: { line: 0, character: 6 } }, text: " = " },
        ]);
    });

    it("no array, a failed provider, a foreign handle, a document out of sync — no edits", async () => {
        const { stub, languages } = makeCtx();
        register(languages, () => undefined);
        expect(await stub.callRequest(METHOD, params())).toEqual([]);
        expect(await stub.callRequest(METHOD, params({ handle: 99 }))).toEqual([]);
        expect(await stub.callRequest(METHOD, params({ uri: "file:///other.java" }))).toEqual([]);

        languages.registerOnTypeFormattingEditProvider(
            "java",
            {
                provideOnTypeFormattingEdits: () => {
                    throw new Error("boom");
                },
            },
            ";",
        );
        expect(await stub.callRequest(METHOD, params({ handle: 1 }))).toEqual([]);
    });
});
