import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Location, Position, Range, Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

function makeCtx(stub: IStubRpc = makeStubRpc()): { ctx: IVscodeHostContext; stub: IStubRpc } {
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    return { ctx, stub };
}

const URI = "file:///proj/main.ts";

const TEXT = "const a = b;\n";

function openDoc(ctx: IVscodeHostContext, text = TEXT, languageId = "typescript"): void {
    ctx.documentSync.open({ uri: URI, languageId, version: 1, text });
}

function requestParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        handle: 0,
        uri: URI,
        languageId: "typescript",
        version: 1,
        line: 0,
        character: 10,
        includeDeclaration: true,
        ...overrides,
    };
}

function location(uri: string, line: number): vscode.Location {
    return new Location(Uri.parse(uri), new Range(line, 2, line, 7)) as unknown as vscode.Location;
}

function wireLocation(uri: string, line: number): unknown {
    return { uri, range: { start: { line: line, character: 2 }, end: { line: line, character: 7 } } };
}

describe("LanguagesNamespace — registerReferenceProvider", () => {
    it("registration is announced to the core with handle and selector, dispose removes it (once)", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const sent = () => stub.notifies.filter((n) => n.method.startsWith("languages."));

        const registration = languages.registerReferenceProvider(
            { language: "typescript" },
            { provideReferences: () => null },
        );
        expect(sent()).toEqual([
            {
                method: "languages.register",
                params: { handle: 0, kind: "references", selector: [{ language: "typescript" }] },
            },
        ]);

        registration.dispose();
        registration.dispose();
        expect(sent().slice(1)).toEqual([{ method: "languages.unregister", params: { handle: 0 } }]);
    });
});

describe("LanguagesNamespace — languages.provideReferences", () => {
    it("document comes from the mirror by request version, provider is called with the cursor position and context", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: { doc?: vscode.TextDocument; pos?: vscode.Position; ctx?: vscode.ReferenceContext } = {};
        languages.registerReferenceProvider(
            { language: "typescript" },
            {
                provideReferences: (document, position, context) => {
                    seen.doc = document;
                    seen.pos = position;
                    seen.ctx = context;
                    return [location("file:///proj/use.ts", 3)];
                },
            },
        );

        openDoc(ctx);
        const result = await stub.callRequest("languages.provideReferences", requestParams());

        expect(seen.doc).toBe(ctx.registry.get(Uri.parse(URI)));
        expect(seen.doc?.getText()).toBe("const a = b;\n");
        expect(seen.doc?.languageId).toBe("typescript");
        expect(seen.pos?.line).toBe(0);
        expect(seen.pos?.character).toBe(10);
        expect(seen.ctx).toEqual({ includeDeclaration: true });
        expect(ctx.registry.get(Uri.parse(URI))?.getText()).toBe("const a = b;\n");
        expect(result).toEqual([wireLocation("file:///proj/use.ts", 3)]);
    });

    it("includeDeclaration: false reaches the provider; false without the field", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: vscode.ReferenceContext[] = [];
        languages.registerReferenceProvider(
            { language: "typescript" },
            {
                provideReferences: (_doc, _pos, context) => {
                    seen.push(context);
                    return [];
                },
            },
        );

        openDoc(ctx);
        await stub.callRequest("languages.provideReferences", requestParams({ includeDeclaration: false }));
        await stub.callRequest("languages.provideReferences", requestParams({ includeDeclaration: undefined }));

        expect(seen).toEqual([{ includeDeclaration: false }, { includeDeclaration: false }]);
    });

    it("exactly the requested handle's provider is called; failing, empty and unknown yield []", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const ask = (handle: unknown) => stub.callRequest("languages.provideReferences", requestParams({ handle }));

        // 0. Working: async, with two references.
        languages.registerReferenceProvider(
            { language: "typescript" },
            {
                provideReferences: () =>
                    Promise.resolve([location("file:///proj/b.ts", 2), location("file:///proj/c.ts", 3)]),
            },
        );
        // 1. Failing: throws synchronously.
        languages.registerReferenceProvider(
            { language: "typescript" },
            {
                provideReferences: () => {
                    throw new Error("boom");
                },
            },
        );
        // 2. Rejected promise.
        languages.registerReferenceProvider(
            { language: "typescript" },
            { provideReferences: () => Promise.reject(new Error("nope")) },
        );
        // 3. null.
        languages.registerReferenceProvider({ language: "typescript" }, { provideReferences: () => null });
        // 4. Second working one.
        languages.registerReferenceProvider(
            { language: "typescript" },
            { provideReferences: () => [location("file:///proj/a.ts", 1)] },
        );

        openDoc(ctx);
        expect(await ask(0)).toEqual([wireLocation("file:///proj/b.ts", 2), wireLocation("file:///proj/c.ts", 3)]);
        expect(await ask(4)).toEqual([wireLocation("file:///proj/a.ts", 1)]);
        expect(await ask(1)).toEqual([]);
        expect(await ask(2)).toEqual([]);
        expect(await ask(3)).toEqual([]);
        expect(await ask(42)).toEqual([]);
        expect(await ask(undefined)).toEqual([]);
    });

    it("non-array from the provider and junk inside the array are dropped", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        // A single Location is the definition shape; for references (`ProviderResult<Location[]>`) it's not accepted.
        languages.registerReferenceProvider(
            { language: "typescript" },
            { provideReferences: () => location("file:///proj/single.ts", 0) as unknown as vscode.Location[] },
        );
        languages.registerReferenceProvider(
            { language: "typescript" },
            {
                provideReferences: () =>
                    [
                        null,
                        42,
                        { uri: "file:///proj/no-range.ts" },
                        { range: new Range(0, 0, 0, 1) },
                        location("file:///proj/ok.ts", 4),
                    ] as unknown as vscode.Location[],
            },
        );

        openDoc(ctx);
        expect(await stub.callRequest("languages.provideReferences", requestParams({ handle: 0 }))).toEqual([]);
        expect(await stub.callRequest("languages.provideReferences", requestParams({ handle: 1 }))).toEqual([
            wireLocation("file:///proj/ok.ts", 4),
        ]);

        expect(await stub.callRequest("languages.provideReferences", requestParams({ handle: undefined }))).toEqual([]);
        const stale = "file:///proj/stale.ts";
        expect(
            await stub.callRequest("languages.provideReferences", requestParams({ handle: 42, uri: stale })),
        ).toEqual([]);
        expect(ctx.registry.get(Uri.parse(stale))).toBeUndefined();
    });

    it("request without position and language: position (0,0), mirror language is not overwritten", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: { pos?: vscode.Position } = {};
        languages.registerReferenceProvider(
            { language: "plaintext" },
            {
                provideReferences: (_doc, position) => {
                    seen.pos = position;
                    return [];
                },
            },
        );

        openDoc(ctx, "", "markdown");
        const result = await stub.callRequest("languages.provideReferences", { handle: 0, uri: URI, version: 1 });

        expect(seen.pos?.line).toBe(0);
        expect(seen.pos?.character).toBe(0);
        expect(ctx.registry.get(Uri.parse(URI))?.languageId).toBe("markdown");
        expect(result).toEqual([]);
    });

    it("no providers yields an empty response, not an error", async () => {
        const { ctx, stub } = makeCtx();
        createLanguagesNamespace(ctx);
        openDoc(ctx);
        expect(await stub.callRequest("languages.provideReferences", requestParams())).toEqual([]);
    });

    it("unopened document, stale request or request ahead of the mirror yields [], provider is not called", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        let calls = 0;
        languages.registerReferenceProvider(
            { language: "typescript" },
            {
                provideReferences: () => {
                    calls++;
                    return [location("file:///proj/use.ts", 3)];
                },
            },
        );

        // Not open: the host hasn't sent didOpen yet (or has already sent didClose).
        expect(await stub.callRequest("languages.provideReferences", requestParams())).toEqual([]);

        openDoc(ctx);
        ctx.documentSync.change({
            uri: URI,
            version: 2,
            changes: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "x" }],
        });
        // Stale: the core has already moved on to v2.
        expect(await stub.callRequest("languages.provideReferences", requestParams({ version: 1 }))).toEqual([]);
        // Ahead of the mirror: the v3 edits haven't arrived — an ordering violation, logged to stderr.
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            expect(await stub.callRequest("languages.provideReferences", requestParams({ version: 3 }))).toEqual([]);
            expect(warn).toHaveBeenCalledTimes(1);
        } finally {
            warn.mockRestore();
        }
        expect(calls).toBe(0);

        expect(await stub.callRequest("languages.provideReferences", requestParams({ version: 2 }))).toEqual([
            wireLocation("file:///proj/use.ts", 3),
        ]);
        expect(calls).toBe(1);
    });
});

describe("LanguagesNamespace — stub Position/Location", () => {
    it("Position from vscodeTypes constructs the way the provider expects", () => {
        // The stock languageclient converter calls `new code.Location(uri, range)`: without
        // constructible stub classes the whole response conversion fails.
        const loc = new Location(Uri.parse(URI), new Position(1, 2));
        expect(loc.range.start.line).toBe(1);
        expect(loc.range.end.character).toBe(2);
    });
});
