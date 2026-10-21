import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { CancellationTokenSource } from "../../../base/common/cancellation.ts";
import { CancellationError, isCancellationError } from "../../../base/common/errorSerialization.ts";
import { Emitter } from "../../../base/common/event.ts";
import { Uri } from "../../../base/common/uri.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { SemanticTokens, SemanticTokensLegend } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

const URI = Uri.file("/proj/Program.cs").toString();
const DOC = { uri: URI, languageId: "csharp", version: 1 };
const RANGE = { start: { line: 0, character: 0 }, end: { line: 1, character: 2 } };
const LEGEND = new SemanticTokensLegend(["class", "variable"], ["declaration"]);

function setup(): { stub: IStubRpc; languages: typeof vscode.languages } {
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
    ctx.documentSync.open({ ...DOC, text: "class A\nvar b\n" });
    const { languages } = createLanguagesNamespace(ctx);
    return { stub, languages };
}

function languageNotifies(stub: IStubRpc): { method: string; params: unknown }[] {
    return stub.notifies.filter((n) => n.method.startsWith("languages."));
}

function fullProvider(data: number[] = [0, 0, 5, 0, 1]): vscode.DocumentSemanticTokensProvider {
    return { provideDocumentSemanticTokens: () => new SemanticTokens(new Uint32Array(data)) };
}

describe("LanguagesNamespace — semantic token registration", () => {
    it("document provider: languages.register with kind, legend and hasOnDidChange", () => {
        const { stub, languages } = setup();
        const emitter = new Emitter<void>();
        languages.registerDocumentSemanticTokensProvider(
            { language: "csharp" },
            { ...fullProvider(), onDidChangeSemanticTokens: emitter.event },
            LEGEND,
        );
        expect(languageNotifies(stub)).toEqual([
            {
                method: "languages.register",
                params: {
                    handle: 0,
                    kind: "semanticTokens",
                    selector: [{ language: "csharp" }],
                    legend: { tokenTypes: ["class", "variable"], tokenModifiers: ["declaration"] },
                    hasOnDidChange: true,
                },
            },
        ]);
    });

    it("range provider without an event: kind rangeSemanticTokens, no hasOnDidChange", () => {
        const { stub, languages } = setup();
        languages.registerDocumentRangeSemanticTokensProvider(
            "csharp",
            { provideDocumentRangeSemanticTokens: () => undefined },
            new SemanticTokensLegend(["a"]),
        );
        expect(languageNotifies(stub)).toEqual([
            {
                method: "languages.register",
                params: {
                    handle: 0,
                    kind: "rangeSemanticTokens",
                    selector: [{ language: "csharp" }],
                    legend: { tokenTypes: ["a"], tokenModifiers: [] },
                },
            },
        ]);
    });

    it("legend is copied: the extension editing the array after registration is not sent", () => {
        const { stub, languages } = setup();
        const legend = new SemanticTokensLegend(["a"], ["m"]);
        languages.registerDocumentSemanticTokensProvider("csharp", fullProvider(), legend);
        legend.tokenTypes.push("b");
        legend.tokenModifiers.push("n");
        expect((languageNotifies(stub)[0].params as { legend: unknown }).legend).toEqual({
            tokenTypes: ["a"],
            tokenModifiers: ["m"],
        });
    });

    it("onDidChangeSemanticTokens → languages.didChangeSemanticTokens with handle; after dispose, silence and unregister", () => {
        const { stub, languages } = setup();
        const first = new Emitter<void>();
        const second = new Emitter<void>();
        languages.registerDocumentSemanticTokensProvider(
            "csharp",
            { ...fullProvider(), onDidChangeSemanticTokens: first.event },
            LEGEND,
        );
        const disposable = languages.registerDocumentRangeSemanticTokensProvider(
            "csharp",
            { provideDocumentRangeSemanticTokens: () => undefined, onDidChangeSemanticTokens: second.event },
            LEGEND,
        );
        second.fire();
        first.fire();
        expect(languageNotifies(stub).filter((n) => n.method === "languages.didChangeSemanticTokens")).toEqual([
            { method: "languages.didChangeSemanticTokens", params: { handle: 1 } },
            { method: "languages.didChangeSemanticTokens", params: { handle: 0 } },
        ]);

        disposable.dispose();
        disposable.dispose();
        second.fire();
        const after = languageNotifies(stub).slice(-1);
        expect(after).toEqual([{ method: "languages.unregister", params: { handle: 1 } }]);
        expect(languageNotifies(stub).filter((n) => n.method === "languages.unregister")).toHaveLength(1);
    });
});

describe("LanguagesNamespace — semantic token requests", () => {
    let errors: unknown[][];
    beforeEach(() => {
        errors = [];
        vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
            errors.push(args);
        });
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("document: adapter answer; previousResultId leads to a delta", async () => {
        const { stub, languages } = setup();
        const answers = [
            [0, 0, 5, 0, 1],
            [0, 0, 5, 1, 1],
        ];
        languages.registerDocumentSemanticTokensProvider(
            "csharp",
            { provideDocumentSemanticTokens: () => new SemanticTokens(new Uint32Array(answers.shift() ?? [])) },
            LEGEND,
        );
        expect(
            await stub.callRequest("languages.provideDocumentSemanticTokens", {
                ...DOC,
                handle: 0,
                previousResultId: 0,
            }),
        ).toEqual({ id: 1, type: "full", data: [0, 0, 5, 0, 1] });
        expect(
            await stub.callRequest("languages.provideDocumentSemanticTokens", {
                ...DOC,
                handle: 0,
                previousResultId: 1,
            }),
        ).toEqual({ id: 2, type: "delta", deltas: [{ start: 3, deleteCount: 1, data: [1] }] });
    });

    it("missing previousResultId in params acts as 0", async () => {
        const { stub, languages } = setup();
        languages.registerDocumentSemanticTokensProvider("csharp", fullProvider([1, 2, 3, 4, 5]), LEGEND);
        expect(await stub.callRequest("languages.provideDocumentSemanticTokens", { ...DOC, handle: 0 })).toEqual({
            id: 1,
            type: "full",
            data: [1, 2, 3, 4, 5],
        });
    });

    it("unknown handle and handle of another kind give null; unsynced or stale document gives cancellation; provider is not called", async () => {
        const { stub, languages } = setup();
        const provide = vi.fn(() => new SemanticTokens(new Uint32Array([0])));
        const range = vi.fn(() => new SemanticTokens(new Uint32Array([0])));
        languages.registerDocumentSemanticTokensProvider("csharp", { provideDocumentSemanticTokens: provide }, LEGEND);
        languages.registerDocumentRangeSemanticTokensProvider(
            "csharp",
            { provideDocumentRangeSemanticTokens: range },
            LEGEND,
        );
        const doc = (p: object) => stub.callRequest("languages.provideDocumentSemanticTokens", p);
        const rng = (p: object) => stub.callRequest("languages.provideDocumentRangeSemanticTokens", p);
        expect(await doc({ ...DOC, handle: 7, previousResultId: 0 })).toBeNull();
        expect(await doc({ ...DOC, handle: 1, previousResultId: 0 })).toBeNull();
        expect(await doc({ ...DOC, previousResultId: 0 })).toBeNull();
        expect(await rng({ ...DOC, handle: 0, range: RANGE })).toBeNull();
        expect(await rng({ ...DOC, range: RANGE })).toBeNull();
        // The core reads `null` as "no tokens" and wipes the highlighting; a stale
        // request must keep it — hence the cancellation.
        const other = Uri.file("/proj/Other.cs").toString();
        await expect(doc({ ...DOC, uri: other, handle: 0 })).rejects.toSatisfy(isCancellationError);
        await expect(doc({ ...DOC, version: 5, handle: 0 })).rejects.toSatisfy(isCancellationError);
        await expect(rng({ ...DOC, uri: other, handle: 1, range: RANGE })).rejects.toSatisfy(isCancellationError);
        await expect(rng({ ...DOC, version: 5, handle: 1, range: RANGE })).rejects.toSatisfy(isCancellationError);
        expect(provide).not.toHaveBeenCalled();
        expect(range).not.toHaveBeenCalled();
        expect(errors).toEqual([]);
    });

    it("handle comes from params: the second provider answers by its handle, without a handle nobody does", async () => {
        const { stub, languages } = setup();
        languages.registerDocumentSemanticTokensProvider("csharp", fullProvider([0, 0, 0, 0, 0]), LEGEND);
        languages.registerDocumentSemanticTokensProvider("csharp", fullProvider([1, 1, 1, 1, 1]), LEGEND);
        const doc = (p: object) => stub.callRequest("languages.provideDocumentSemanticTokens", { ...DOC, ...p });
        expect(await doc({ previousResultId: 0 })).toBeNull();
        expect(await doc({ handle: 1, previousResultId: 0 })).toEqual({ id: 1, type: "full", data: [1, 1, 1, 1, 1] });
        // A release without a handle doesn't touch the second provider.
        stub.fire("languages.releaseDocumentSemanticTokens", { resultId: 1 });
        expect(await doc({ handle: 1, previousResultId: 1 })).toEqual({ id: 2, type: "delta", deltas: [] });
        stub.fire("languages.releaseDocumentSemanticTokens", { handle: 1, resultId: 2 });
        expect(await doc({ handle: 1, previousResultId: 2 })).toEqual({ id: 3, type: "full", data: [1, 1, 1, 1, 1] });
    });

    it("range: provider gets a vscode.Range from the wire, answer is full with id 0", async () => {
        const { stub, languages } = setup();
        let seen: vscode.Range | undefined;
        languages.registerDocumentRangeSemanticTokensProvider(
            "csharp",
            {
                provideDocumentRangeSemanticTokens: (_doc, range) => {
                    seen = range;
                    return new SemanticTokens(new Uint32Array([1, 0, 1, 1, 0]));
                },
            },
            LEGEND,
        );
        expect(
            await stub.callRequest("languages.provideDocumentRangeSemanticTokens", { ...DOC, handle: 0, range: RANGE }),
        ).toEqual({ id: 0, type: "full", data: [1, 0, 1, 1, 0] });
        expect([seen?.start.line, seen?.start.character, seen?.end.line, seen?.end.character]).toEqual([0, 0, 1, 2]);
    });

    it("provider failure reaches the core as an exception and a stderr line; cancellation reaches the provider token", async () => {
        const { stub, languages } = setup();
        let token: vscode.CancellationToken | undefined;
        languages.registerDocumentSemanticTokensProvider(
            "csharp",
            {
                provideDocumentSemanticTokens: (_doc, t) => {
                    token = t;
                    throw new Error("boom");
                },
            },
            LEGEND,
        );
        languages.registerDocumentRangeSemanticTokensProvider(
            "csharp",
            {
                provideDocumentRangeSemanticTokens: () => {
                    throw new Error("bang");
                },
            },
            LEGEND,
        );
        const cancellation = new CancellationTokenSource();
        const pending = stub.callRequest(
            "languages.provideDocumentSemanticTokens",
            { ...DOC, handle: 0, previousResultId: 0 },
            cancellation.token,
        );
        expect(token?.isCancellationRequested).toBe(false);
        cancellation.cancel();
        expect(token?.isCancellationRequested).toBe(true);
        await expect(pending).rejects.toThrow(new Error("boom"));
        await expect(
            stub.callRequest("languages.provideDocumentRangeSemanticTokens", { ...DOC, handle: 1, range: RANGE }),
        ).rejects.toThrow(new Error("bang"));
        expect(errors.map((e) => String(e[0]).split("\n")[0])).toEqual([
            "[ext-host] provideDocumentSemanticTokens failed: Error: boom",
            "[ext-host] provideDocumentRangeSemanticTokens failed: Error: bang",
        ]);
    });

    it("provider CancellationError (ContentModified in vscode-languageclient) is a cancellation to the core without stderr", async () => {
        const { stub, languages } = setup();
        languages.registerDocumentSemanticTokensProvider(
            "csharp",
            {
                provideDocumentSemanticTokens: () => {
                    throw new CancellationError();
                },
            },
            LEGEND,
        );
        await expect(
            stub.callRequest("languages.provideDocumentSemanticTokens", { ...DOC, handle: 0, previousResultId: 0 }),
        ).rejects.toSatisfy(isCancellationError);
        expect(errors).toEqual([]);
    });

    it("releaseDocumentSemanticTokens forgets the answer: the next request with its id is full", async () => {
        const { stub, languages } = setup();
        languages.registerDocumentSemanticTokensProvider("csharp", fullProvider([1, 1, 1, 1, 1]), LEGEND);
        await stub.callRequest("languages.provideDocumentSemanticTokens", { ...DOC, handle: 0, previousResultId: 0 });
        stub.fire("languages.releaseDocumentSemanticTokens", { handle: 9, resultId: 1 });
        stub.fire("languages.releaseDocumentSemanticTokens", null);
        stub.fire("languages.releaseDocumentSemanticTokens", { handle: 0 });
        expect(
            await stub.callRequest("languages.provideDocumentSemanticTokens", {
                ...DOC,
                handle: 0,
                previousResultId: 1,
            }),
        ).toEqual({ id: 2, type: "delta", deltas: [] });

        stub.fire("languages.releaseDocumentSemanticTokens", { handle: 0, resultId: 2 });
        expect(
            await stub.callRequest("languages.provideDocumentSemanticTokens", {
                ...DOC,
                handle: 0,
                previousResultId: 2,
            }),
        ).toEqual({ id: 3, type: "full", data: [1, 1, 1, 1, 1] });
    });
});
