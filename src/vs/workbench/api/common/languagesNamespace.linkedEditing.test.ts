import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { LinkedEditingRanges, Range } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

const URI = "file:///proj/main.tsx";
const METHOD = "languages.provideLinkedEditingRanges";

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
    ctx.documentSync.open({ uri: URI, languageId: "typescriptreact", version: 1, text: "<aaa></aaa>\n" });
    return { stub, languages };
}

function params(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { handle: 0, uri: URI, languageId: "typescriptreact", version: 1, line: 0, character: 2, ...overrides };
}

function register(languages: typeof vscode.languages, answer: () => unknown): void {
    languages.registerLinkedEditingRangeProvider("typescriptreact", {
        provideLinkedEditingRanges: answer as vscode.LinkedEditingRangeProvider["provideLinkedEditingRanges"],
    });
}

describe("LanguagesNamespace — registerLinkedEditingRangeProvider", () => {
    it("registration is announced to the core as kind linkedEditingRange, dispose removes it", () => {
        const { stub, languages } = makeCtx();
        languages
            .registerLinkedEditingRangeProvider("typescriptreact", { provideLinkedEditingRanges: () => undefined })
            .dispose();
        expect(stub.notifies.filter((n) => n.method.startsWith("languages."))).toEqual([
            {
                method: "languages.register",
                params: { handle: 0, kind: "linkedEditingRange", selector: [{ language: "typescriptreact" }] },
            },
            { method: "languages.unregister", params: { handle: 0 } },
        ]);
    });

    it("the provider gets the synced document and the position", async () => {
        const { stub, languages } = makeCtx();
        const provide = vi.fn<(document: vscode.TextDocument, position: vscode.Position) => unknown>(() => undefined);
        register(languages, provide as never);
        await stub.callRequest(METHOD, params());

        const [document, position] = provide.mock.calls[0];
        expect(document.uri.toString()).toBe(URI);
        expect({ line: position.line, character: position.character }).toEqual({ line: 0, character: 2 });
    });

    it("ranges and the word pattern with its flags go over the wire", async () => {
        const { stub, languages } = makeCtx();
        register(languages, () => new LinkedEditingRanges([new Range(0, 1, 0, 4), new Range(0, 7, 0, 10)], /[a-z]+/i));
        expect(await stub.callRequest(METHOD, params())).toEqual({
            ranges: [
                { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } },
                { start: { line: 0, character: 7 }, end: { line: 0, character: 10 } },
            ],
            wordPattern: "[a-z]+",
            wordPatternFlags: "i",
        });
    });

    it("no word pattern: the keys are absent", async () => {
        const { stub, languages } = makeCtx();
        register(languages, () => new LinkedEditingRanges([new Range(0, 1, 0, 4)]));
        expect(await stub.callRequest(METHOD, params())).toEqual({
            ranges: [{ start: { line: 0, character: 1 }, end: { line: 0, character: 4 } }],
        });
    });

    it("an entry that is not a range is dropped, a pattern that is not a RegExp too", async () => {
        const { stub, languages } = makeCtx();
        register(languages, () => ({ ranges: [null, new Range(0, 1, 0, 4), { nope: 1 }], wordPattern: "[a-z]+" }));
        expect(await stub.callRequest(METHOD, params())).toEqual({
            ranges: [{ start: { line: 0, character: 1 }, end: { line: 0, character: 4 } }],
        });
    });

    it.each([
        ["undefined", undefined],
        ["null", null],
        ["no ranges", {}],
        ["ranges not an array", { ranges: 1 }],
    ])("%s is null: the provider declined", async (_name, answer) => {
        const { stub, languages } = makeCtx();
        register(languages, () => answer);
        expect(await stub.callRequest(METHOD, params())).toBeNull();
    });

    it("a throwing provider is null, and the rejection does not reach the host", async () => {
        const { stub, languages } = makeCtx();
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        register(languages, () => {
            throw new Error("boom");
        });
        expect(await stub.callRequest(METHOD, params())).toBeNull();
        error.mockRestore();
    });

    it("an unknown handle and an unsynced document are null", async () => {
        const { stub, languages } = makeCtx();
        const provide = vi.fn(() => new LinkedEditingRanges([]));
        register(languages, provide);
        expect(await stub.callRequest(METHOD, params({ handle: 9 }))).toBeNull();
        expect(await stub.callRequest(METHOD, params({ uri: "file:///other.tsx" }))).toBeNull();
        expect(provide).not.toHaveBeenCalled();
    });

    it("the class keeps what it is given", () => {
        const ranges = [new Range(0, 1, 0, 4)];
        const pattern = /x/;
        const value = new LinkedEditingRanges(ranges, pattern);
        expect(value.ranges).toBe(ranges);
        expect(value.wordPattern).toBe(pattern);
        expect(new LinkedEditingRanges(ranges).wordPattern).toBeUndefined();
    });
});
