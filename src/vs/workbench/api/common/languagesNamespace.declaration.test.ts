import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { CancellationTokenSource } from "../../../base/common/cancellation.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Location, Range, Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

const URI = "file:///proj/main.ts";
const IMPL = Uri.file("/proj/impl.ts");

function makeCtx(): { ctx: IVscodeHostContext; stub: IStubRpc } {
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
    ctx.documentSync.open({ uri: URI, languageId: "typescript", version: 1, text: "const a = b;\n" });
    return { ctx, stub };
}

const params = (handle = 0) => ({ handle, uri: URI, languageId: "typescript", version: 1, line: 0, character: 10 });
const wireRange = (line: number, from: number, to: number) => ({
    start: { line, character: from },
    end: { line, character: to },
});

describe("LanguagesNamespace — registerDeclarationProvider", () => {
    it("is announced to the core under its own kind; dispose removes it", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const sent = () => stub.notifies.filter((n) => n.method.startsWith("languages."));

        const registration = languages.registerDeclarationProvider(
            { language: "typescript" },
            { provideDeclaration: () => null },
        );

        expect(sent()).toEqual([
            {
                method: "languages.register",
                params: { handle: 0, kind: "declaration", selector: [{ language: "typescript" }] },
            },
        ]);
        registration.dispose();
        expect(sent().slice(1)).toEqual([{ method: "languages.unregister", params: { handle: 0 } }]);
    });
});

describe("LanguagesNamespace — languages.provideDeclaration", () => {
    it("the provider gets the mirrored document and the cursor; Location[] serializes whole", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: { doc?: vscode.TextDocument; pos?: vscode.Position } = {};
        languages.registerDeclarationProvider(
            { language: "typescript" },
            {
                provideDeclaration: (document, position) => {
                    seen.doc = document;
                    seen.pos = position;
                    return [
                        new Location(IMPL as unknown as vscode.Uri, new Range(1, 2, 1, 6)),
                        new Location(IMPL as unknown as vscode.Uri, new Range(5, 2, 5, 6)),
                    ] as unknown as vscode.Location[];
                },
            },
        );

        const result = await stub.callRequest("languages.provideDeclaration", params());

        expect(seen.doc).toBe(ctx.registry.get(Uri.parse(URI)));
        expect(seen.pos?.line).toBe(0);
        expect(seen.pos?.character).toBe(10);
        expect(result).toEqual([
            { uri: IMPL.toString(), range: wireRange(1, 2, 6) },
            { uri: IMPL.toString(), range: wireRange(5, 2, 6) },
        ]);
    });

    it("a single Location and a LocationLink, whose target is targetSelectionRange", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerDeclarationProvider(
            { language: "typescript" },
            {
                provideDeclaration: () =>
                    new Location(IMPL as unknown as vscode.Uri, new Range(2, 0, 2, 3)) as unknown as vscode.Location,
            },
        );
        languages.registerDeclarationProvider(
            { language: "typescript" },
            {
                provideDeclaration: () =>
                    [
                        {
                            targetUri: IMPL as unknown as vscode.Uri,
                            targetRange: new Range(5, 0, 8, 1) as unknown as vscode.Range,
                            targetSelectionRange: new Range(5, 9, 5, 14) as unknown as vscode.Range,
                        },
                    ] as vscode.DefinitionLink[],
            },
        );

        expect(await stub.callRequest("languages.provideDeclaration", params(0))).toEqual([
            { uri: IMPL.toString(), range: wireRange(2, 0, 3) },
        ]);
        expect(await stub.callRequest("languages.provideDeclaration", params(1))).toEqual([
            { uri: IMPL.toString(), range: wireRange(5, 9, 14) },
        ]);
    });

    it("a failing provider is an empty answer and a report naming the method and the owner", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerDeclarationProvider(
            { language: "typescript" },
            {
                provideDeclaration: () => {
                    throw new Error("boom");
                },
            },
        );
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
            expect(await stub.callRequest("languages.provideDeclaration", params())).toEqual([]);
            expect(error).toHaveBeenCalledTimes(1);
            expect(error.mock.calls[0]?.[0]).toContain("provideDeclaration failed: ");
        } finally {
            error.mockRestore();
        }
    });

    it("an unknown handle or an unopened document: the provider is not called", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const provideDeclaration = vi.fn(() => null);
        languages.registerDeclarationProvider({ language: "typescript" }, { provideDeclaration });

        expect(await stub.callRequest("languages.provideDeclaration", params(42))).toEqual([]);
        expect(
            await stub.callRequest("languages.provideDeclaration", { ...params(), uri: "file:///proj/other.ts" }),
        ).toEqual([]);
        expect(provideDeclaration).not.toHaveBeenCalled();
    });

    it("definition and declaration handlers read their own providers", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const provideDefinition = vi.fn(() => null);
        languages.registerDefinitionProvider({ language: "typescript" }, { provideDefinition });

        expect(await stub.callRequest("languages.provideDeclaration", params(0))).toEqual([]);
        expect(provideDefinition).not.toHaveBeenCalled();
    });

    it("the provider's token follows the request cancellation", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        let seen: vscode.CancellationToken | undefined;
        languages.registerDeclarationProvider(
            { language: "typescript" },
            {
                provideDeclaration: (_document, _position, token) => {
                    seen = token;
                    return new Promise(() => undefined);
                },
            },
        );
        const source = new CancellationTokenSource();

        void stub.callRequest("languages.provideDeclaration", params(), source.token);
        expect(seen?.isCancellationRequested).toBe(false);

        source.cancel();
        expect(seen?.isCancellationRequested).toBe(true);
    });
});
