import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { EvaluatableExpression, Range } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

const URI = "file:///proj/main.cpp";
const METHOD = "languages.provideEvaluatableExpression";

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
    ctx.documentSync.open({ uri: URI, languageId: "cpp", version: 1, text: "int nums = 0;\n" });
    return { stub, languages };
}

function params(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { handle: 0, uri: URI, languageId: "cpp", version: 1, line: 0, character: 5, ...overrides };
}

function register(languages: typeof vscode.languages, answer: () => unknown): void {
    languages.registerEvaluatableExpressionProvider("cpp", {
        provideEvaluatableExpression: answer as vscode.EvaluatableExpressionProvider["provideEvaluatableExpression"],
    });
}

describe("LanguagesNamespace — registerEvaluatableExpressionProvider", () => {
    it("[api:languages.registerEvaluatableExpressionProvider] registration is announced as kind evaluatableExpression, dispose removes it", () => {
        const { stub, languages } = makeCtx();
        languages
            .registerEvaluatableExpressionProvider("cpp", { provideEvaluatableExpression: () => undefined })
            .dispose();
        expect(stub.notifies.filter((n) => n.method.startsWith("languages."))).toEqual([
            {
                method: "languages.register",
                params: { handle: 0, kind: "evaluatableExpression", selector: [{ language: "cpp" }] },
            },
            { method: "languages.unregister", params: { handle: 0 } },
        ]);
    });

    it("[api:EvaluatableExpressionProvider.provideEvaluatableExpression] the provider gets the synced document and the position", async () => {
        const { stub, languages } = makeCtx();
        const provide = vi.fn<(document: vscode.TextDocument, position: vscode.Position) => unknown>(() => undefined);
        register(languages, provide as never);
        await stub.callRequest(METHOD, params());

        const [document, position] = provide.mock.calls[0];
        expect(document.uri.toString()).toBe(URI);
        expect({ line: position.line, character: position.character }).toEqual({ line: 0, character: 5 });
        await stub.callRequest(METHOD, params({ line: 1, character: undefined }));
        expect({ line: provide.mock.calls[1][1].line, character: provide.mock.calls[1][1].character }).toEqual({
            line: 1,
            character: 0,
        });
        await stub.callRequest(METHOD, params({ line: undefined }));
        expect(provide.mock.calls[2][1].line).toBe(0);
    });

    it("[api:EvaluatableExpression] the range and the expression go over the wire", async () => {
        const { stub, languages } = makeCtx();
        register(languages, () => new EvaluatableExpression(new Range(0, 4, 0, 8), "nums.size()"));
        expect(await stub.callRequest(METHOD, params())).toEqual({
            range: { start: { line: 0, character: 4 }, end: { line: 0, character: 8 } },
            expression: "nums.size()",
        });
    });

    it("[api:EvaluatableExpression.range] a range alone: the expression is absent", async () => {
        const { stub, languages } = makeCtx();
        register(languages, () => ({ range: new Range(0, 4, 0, 8), expression: 42 }));
        expect(await stub.callRequest(METHOD, params())).toEqual({
            range: { start: { line: 0, character: 4 }, end: { line: 0, character: 8 } },
        });
    });

    it.each([
        ["undefined", undefined],
        ["null", null],
        ["no range", { expression: "nums" }],
        ["a range that is not one", { range: { start: 1 } }],
    ])("%s is null: nothing at the position", async (_name, answer) => {
        const { stub, languages } = makeCtx();
        register(languages, () => answer);
        expect(await stub.callRequest(METHOD, params())).toBeNull();
    });

    it("a throwing provider is null, is reported and the host lives on", async () => {
        const { stub, languages } = makeCtx();
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        register(languages, () => {
            throw new Error("boom");
        });
        expect(await stub.callRequest(METHOD, params())).toBeNull();
        expect(errors).toHaveBeenCalledWith(expect.stringContaining("provideEvaluatableExpression failed: "));
        errors.mockRestore();
    });

    it("the request goes to the provider of its handle; an unknown handle and an unsynced document are null", async () => {
        const { stub, languages } = makeCtx();
        const first = vi.fn(() => undefined);
        const second = vi.fn(() => undefined);
        register(languages, first);
        register(languages, second);
        expect(await stub.callRequest(METHOD, params({ handle: undefined }))).toBeNull();
        expect(await stub.callRequest(METHOD, params({ handle: 9 }))).toBeNull();
        expect(await stub.callRequest(METHOD, params({ uri: "file:///other.cpp" }))).toBeNull();
        expect(first).not.toHaveBeenCalled();
        await stub.callRequest(METHOD, params({ handle: 1 }));
        expect(second).toHaveBeenCalledTimes(1);
        expect(first).not.toHaveBeenCalled();
    });

    it("[api:EvaluatableExpression.expression] the class keeps what it is given", () => {
        const range = new Range(0, 1, 0, 4);
        const value = new EvaluatableExpression(range, "a.b");
        expect(value.range).toBe(range);
        expect(value.expression).toBe("a.b");
        expect(new EvaluatableExpression(range).expression).toBeUndefined();
    });
});
