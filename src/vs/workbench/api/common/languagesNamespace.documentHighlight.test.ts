import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { DocumentHighlight, DocumentHighlightKind, Range } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

const URI = "file:///proj/main.ts";
const METHOD = "languages.provideDocumentHighlights";

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
    ctx.documentSync.open({ uri: URI, languageId: "typescript", version: 1, text: "let x = 1;\n" });
    return { stub, languages };
}

function params(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { handle: 0, uri: URI, languageId: "typescript", version: 1, line: 0, character: 4, ...overrides };
}

function register(languages: typeof vscode.languages, answer: () => unknown): void {
    languages.registerDocumentHighlightProvider("typescript", {
        provideDocumentHighlights: answer as vscode.DocumentHighlightProvider["provideDocumentHighlights"],
    });
}

describe("LanguagesNamespace — registerDocumentHighlightProvider", () => {
    it("registration is announced to the core as kind documentHighlight, dispose removes it", () => {
        const { stub, languages } = makeCtx();
        languages.registerDocumentHighlightProvider("typescript", { provideDocumentHighlights: () => [] }).dispose();
        expect(stub.notifies.filter((n) => n.method.startsWith("languages."))).toEqual([
            {
                method: "languages.register",
                params: { handle: 0, kind: "documentHighlight", selector: [{ language: "typescript" }] },
            },
            { method: "languages.unregister", params: { handle: 0 } },
        ]);
    });

    it("the provider gets the synced document and the position", async () => {
        const { stub, languages } = makeCtx();
        const provide = vi.fn<(document: vscode.TextDocument, position: vscode.Position) => unknown>(() => []);
        register(languages, provide as never);
        await stub.callRequest(METHOD, params());

        const [document, position] = provide.mock.calls[0];
        expect(document.uri.toString()).toBe(URI);
        expect({ line: position.line, character: position.character }).toEqual({ line: 0, character: 4 });
    });

    it("a request without a position asks at the start of the document", async () => {
        const { stub, languages } = makeCtx();
        const provide = vi.fn<(document: vscode.TextDocument, position: vscode.Position) => unknown>(() => []);
        register(languages, provide as never);
        await stub.callRequest(METHOD, params({ line: undefined, character: undefined }));

        const [, position] = provide.mock.calls[0];
        expect({ line: position.line, character: position.character }).toEqual({ line: 0, character: 0 });
    });

    it("ranges and kinds go over the wire; the class defaults to Text", async () => {
        const { stub, languages } = makeCtx();
        register(languages, () => [
            new DocumentHighlight(new Range(0, 4, 0, 5), DocumentHighlightKind.Write),
            new DocumentHighlight(new Range(1, 0, 1, 1), DocumentHighlightKind.Read),
            new DocumentHighlight(new Range(2, 0, 2, 1)),
        ]);
        const range = (line: number, start: number, end: number): unknown => ({
            start: { line, character: start },
            end: { line, character: end },
        });
        expect(await stub.callRequest(METHOD, params())).toEqual([
            { range: range(0, 4, 5), kind: 2 },
            { range: range(1, 0, 1), kind: 1 },
            { range: range(2, 0, 1), kind: 0 },
        ]);
    });

    it("a plain object without a kind stays without one", async () => {
        const { stub, languages } = makeCtx();
        register(languages, () => [{ range: new Range(0, 4, 0, 5) }]);
        expect(await stub.callRequest(METHOD, params())).toEqual([
            { range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } } },
        ]);
    });

    it("an empty array stays an answer", async () => {
        const { stub, languages } = makeCtx();
        register(languages, () => []);
        expect(await stub.callRequest(METHOD, params())).toEqual([]);
    });

    it.each([
        ["undefined", undefined],
        ["null", null],
        ["garbage", 7],
    ])("%s means the provider declined", async (_, answer) => {
        const { stub, languages } = makeCtx();
        register(languages, () => answer);
        expect(await stub.callRequest(METHOD, params())).toBeNull();
    });

    it("a thenable answer is awaited", async () => {
        const { stub, languages } = makeCtx();
        register(languages, () => Promise.resolve([]));
        expect(await stub.callRequest(METHOD, params())).toEqual([]);
    });

    it("entries without a range are dropped, the rest stay", async () => {
        const { stub, languages } = makeCtx();
        register(languages, () => [null, {}, { range: new Range(0, 4, 0, 5) }]);
        expect(await stub.callRequest(METHOD, params())).toHaveLength(1);
    });

    it("a throwing provider declines, is reported and the host lives on", async () => {
        const { stub, languages } = makeCtx();
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        register(languages, () => {
            throw new Error("boom");
        });
        expect(await stub.callRequest(METHOD, params())).toBeNull();
        expect(errors).toHaveBeenCalledWith(expect.stringContaining("provideDocumentHighlights failed: "));
        errors.mockRestore();
    });

    it("the position comes from the request, on any line", async () => {
        const { stub, languages } = makeCtx();
        const provide = vi.fn<(document: vscode.TextDocument, position: vscode.Position) => unknown>(() => []);
        register(languages, provide as never);
        await stub.callRequest(METHOD, params({ line: 1, character: 0 }));

        expect(provide.mock.calls[0][1].line).toBe(1);
    });

    it("the request goes to the provider of its handle; without a handle to none", async () => {
        const { stub, languages } = makeCtx();
        const first = vi.fn(() => []);
        const second = vi.fn(() => []);
        register(languages, first);
        register(languages, second);

        expect(await stub.callRequest(METHOD, params({ handle: undefined }))).toBeNull();
        expect(second).not.toHaveBeenCalled();
        expect(await stub.callRequest(METHOD, params({ handle: 1 }))).toEqual([]);
        expect(second).toHaveBeenCalledOnce();
        expect(first).not.toHaveBeenCalled();
    });

    it("an unknown handle or an unsynced document declines without calling anything", async () => {
        const { stub, languages } = makeCtx();
        const provide = vi.fn(() => []);
        register(languages, provide);
        expect(await stub.callRequest(METHOD, params({ handle: 99 }))).toBeNull();
        expect(await stub.callRequest(METHOD, params({ uri: "file:///other.ts" }))).toBeNull();
        expect(provide).not.toHaveBeenCalled();
    });
});
