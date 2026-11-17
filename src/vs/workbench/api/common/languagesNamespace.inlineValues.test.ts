import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { InlineValueEvaluatableExpression, InlineValueText, InlineValueVariableLookup, Range } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

const URI = "file:///proj/main.c";
const METHOD = "languages.provideInlineValues";
const WIRE_RANGE = { start: { line: 1, character: 4 }, end: { line: 1, character: 7 } };

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
    ctx.documentSync.open({ uri: URI, languageId: "c", version: 1, text: "int main() {\n    int sum = 0;\n}\n" });
    return { stub, languages };
}

function params(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        handle: 0,
        uri: URI,
        languageId: "c",
        version: 1,
        viewPort: { start: { line: 0, character: 0 }, end: { line: 2, character: 1 } },
        context: { frameId: 7, stoppedLocation: WIRE_RANGE },
        ...overrides,
    };
}

function register(languages: typeof vscode.languages, answer: () => unknown): void {
    languages.registerInlineValuesProvider("c", {
        provideInlineValues: answer as vscode.InlineValuesProvider["provideInlineValues"],
    });
}

describe("LanguagesNamespace — registerInlineValuesProvider", () => {
    it("registration is announced to the core as kind inlineValues, dispose removes it", () => {
        const { stub, languages } = makeCtx();
        languages.registerInlineValuesProvider("c", { provideInlineValues: () => undefined }).dispose();
        expect(stub.notifies.filter((n) => n.method.startsWith("languages."))).toEqual([
            {
                method: "languages.register",
                params: { handle: 0, kind: "inlineValues", selector: [{ language: "c" }] },
            },
            { method: "languages.unregister", params: { handle: 0 } },
        ]);
    });

    it("the provider gets the synced document, the view port and the frame's context", async () => {
        const { stub, languages } = makeCtx();
        const provide = vi.fn<
            (document: vscode.TextDocument, viewPort: vscode.Range, context: vscode.InlineValueContext) => unknown
        >(() => undefined);
        register(languages, provide as never);
        await stub.callRequest(METHOD, params());

        const [document, viewPort, context] = provide.mock.calls[0];
        expect(document.uri.toString()).toBe(URI);
        expect(viewPort).toEqual(new Range(0, 0, 2, 1));
        expect(viewPort).toBeInstanceOf(Range);
        expect(context.frameId).toBe(7);
        expect(context.stoppedLocation).toEqual(new Range(1, 4, 1, 7));
        expect(context.stoppedLocation).toBeInstanceOf(Range);
    });

    it("the three kinds go over the wire; the lookup is case sensitive by default", async () => {
        const { stub, languages } = makeCtx();
        const range = new Range(1, 4, 1, 7);
        register(languages, () => [
            new InlineValueText(range, "sum: 0"),
            new InlineValueVariableLookup(range),
            new InlineValueVariableLookup(range, "Sum", false),
            new InlineValueEvaluatableExpression(range),
            new InlineValueEvaluatableExpression(range, "sum * 2"),
        ]);
        expect(await stub.callRequest(METHOD, params())).toEqual([
            { type: "text", range: WIRE_RANGE, text: "sum: 0" },
            { type: "variable", range: WIRE_RANGE, caseSensitiveLookup: true },
            { type: "variable", range: WIRE_RANGE, variableName: "Sum", caseSensitiveLookup: false },
            { type: "expression", range: WIRE_RANGE },
            { type: "expression", range: WIRE_RANGE, expression: "sum * 2" },
        ]);
    });

    it("an empty name or expression is absent: the range's text is used, as upstream", async () => {
        const { stub, languages } = makeCtx();
        const range = new Range(1, 4, 1, 7);
        register(languages, () => [
            new InlineValueVariableLookup(range, ""),
            new InlineValueEvaluatableExpression(range, ""),
        ]);
        expect(await stub.callRequest(METHOD, params())).toEqual([
            { type: "variable", range: WIRE_RANGE, caseSensitiveLookup: true },
            { type: "expression", range: WIRE_RANGE },
        ]);
    });

    it("a name or an expression that is not a string is absent", async () => {
        const { stub, languages } = makeCtx();
        const range = new Range(1, 4, 1, 7);
        register(languages, () => [
            new InlineValueVariableLookup(range, 5 as never),
            new InlineValueEvaluatableExpression(range, 5 as never),
        ]);
        expect(await stub.callRequest(METHOD, params())).toEqual([
            { type: "variable", range: WIRE_RANGE, caseSensitiveLookup: true },
            { type: "expression", range: WIRE_RANGE },
        ]);
    });

    it("each provider answers by its handle", async () => {
        const { stub, languages } = makeCtx();
        register(languages, () => [new InlineValueText(new Range(0, 0, 0, 1), "first")]);
        register(languages, () => [new InlineValueText(new Range(0, 0, 0, 1), "second")]);
        expect(await stub.callRequest(METHOD, params({ handle: 1 }))).toEqual([
            {
                type: "text",
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                text: "second",
            },
        ]);
    });

    it("an entry that is none of the classes, or has no range, is dropped", async () => {
        const { stub, languages } = makeCtx();
        register(languages, () => [
            { range: new Range(1, 4, 1, 7), text: "plain" },
            null,
            new InlineValueText(undefined as never, "no range"),
            new InlineValueText(new Range(1, 4, 1, 7), "kept"),
        ]);
        expect(await stub.callRequest(METHOD, params())).toEqual([{ type: "text", range: WIRE_RANGE, text: "kept" }]);
    });

    it.each([
        ["undefined", undefined],
        ["null", null],
        ["not an array", { values: [] }],
    ])("%s is null", async (_name, answer) => {
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
        expect(errors).toHaveBeenCalledWith(expect.stringContaining("provideInlineValues failed: "));
        errors.mockRestore();
    });

    it("an unknown or missing handle, or a document that is not synced, is null, the provider is not asked", async () => {
        const { stub, languages } = makeCtx();
        const provide = vi.fn(() => [new InlineValueText(new Range(0, 0, 0, 1), "x")]);
        // Two registrations (handles 0 and 1): a request without a handle reaches neither.
        register(languages, provide);
        register(languages, provide);
        expect(await stub.callRequest(METHOD, params({ handle: 9 }))).toBeNull();
        expect(await stub.callRequest(METHOD, params({ handle: undefined }))).toBeNull();
        expect(await stub.callRequest(METHOD, params({ uri: "file:///proj/other.c" }))).toBeNull();
        expect(provide).not.toHaveBeenCalled();
    });
});
