import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Hover, MarkdownString, Range, Uri } from "./vscodeTypes.ts";
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

function openDoc(ctx: IVscodeHostContext, text = TEXT, languageId = "typescript", uri = URI): void {
    ctx.documentSync.open({ uri, languageId, version: 1, text });
}

function requestParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        handle: 0,
        uri: URI,
        languageId: "typescript",
        version: 1,
        line: 0,
        character: 10,
        ...overrides,
    };
}

describe("LanguagesNamespace — registerHoverProvider", () => {
    it("each registration is announced to the core with a handle and selector, dispose removes it", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const sent = () => stub.notifies.filter((n) => n.method.startsWith("languages."));

        const first = languages.registerHoverProvider({ language: "typescript" }, { provideHover: () => null });
        const second = languages.registerHoverProvider("markdown", { provideHover: () => null });
        expect(sent()).toEqual([
            {
                method: "languages.register",
                params: { handle: 0, kind: "hover", selector: [{ language: "typescript" }] },
            },
            {
                method: "languages.register",
                params: { handle: 1, kind: "hover", selector: [{ language: "markdown" }] },
            },
        ]);

        first.dispose();
        second.dispose();
        expect(sent().slice(2)).toEqual([
            { method: "languages.unregister", params: { handle: 0 } },
            { method: "languages.unregister", params: { handle: 1 } },
        ]);

        // A repeated dispose is idempotent, with no extra notifications.
        second.dispose();
        expect(sent()).toHaveLength(4);
    });

    it("a removed provider does not answer a request for its handle", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const registration = languages.registerHoverProvider(
            { language: "typescript" },
            { provideHover: () => new Hover("alive") as unknown as vscode.Hover },
        );
        openDoc(ctx);
        expect(await stub.callRequest("languages.provideHover", requestParams())).toEqual({ contents: ["alive"] });

        registration.dispose();

        expect(await stub.callRequest("languages.provideHover", requestParams())).toBeNull();
    });
});

describe("LanguagesNamespace — languages.provideHover", () => {
    it("the document comes from the mirror by request version, the provider is called with the cursor position", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        openDoc(ctx);
        const seen: { doc?: vscode.TextDocument; pos?: vscode.Position } = {};
        languages.registerHoverProvider(
            { language: "typescript" },
            {
                provideHover: (document, position) => {
                    seen.doc = document;
                    seen.pos = position;
                    return new Hover(
                        new MarkdownString("```ts\nconst a: number\n```"),
                        new Range(0, 6, 0, 7) as unknown as vscode.Range,
                    ) as unknown as vscode.Hover;
                },
            },
        );

        const result = await stub.callRequest("languages.provideHover", requestParams());

        expect(seen.doc).toBe(ctx.registry.get(Uri.parse(URI)));
        expect(seen.doc?.getText()).toBe("const a = b;\n");
        expect(seen.doc?.languageId).toBe("typescript");
        expect(seen.pos?.line).toBe(0);
        expect(seen.pos?.character).toBe(10);
        expect(ctx.registry.get(Uri.parse(URI))?.getText()).toBe("const a = b;\n");
        expect(result).toEqual({
            contents: ["```ts\nconst a: number\n```"],
            range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
        });
    });

    it("contents are normalized: string, MarkdownString and MarkedString codeblock → markdown blocks", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerHoverProvider(
            { language: "typescript" },
            {
                provideHover: () =>
                    ({
                        contents: [
                            "just a string",
                            new MarkdownString("**markdown**"),
                            { language: "ts", value: "const b = 1" }, // legacy MarkedString
                            { language: "", value: "no language" },
                            "", // an empty block is dropped
                            "   \n  ", // whitespace only — also empty
                            42, // garbage is dropped
                            {}, // an object without value — garbage too
                            null, // typeof null === "object", but it has no fields
                        ],
                        // no range — a hover without a range is valid
                    }) as unknown as vscode.Hover,
            },
        );

        openDoc(ctx);
        const result = await stub.callRequest("languages.provideHover", requestParams());

        expect(result).toEqual({
            contents: ["just a string", "**markdown**", "```ts\nconst b = 1\n```", "no language"],
        });
    });

    it("non-array contents and a request without position and language: position is (0,0), the mirror language is not overwritten", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: { pos?: vscode.Position } = {};
        languages.registerHoverProvider(
            { language: "plaintext" },
            {
                provideHover: (_doc, position) => {
                    seen.pos = position;
                    return { contents: "a single string, not in an array" } as unknown as vscode.Hover;
                },
            },
        );

        openDoc(ctx, "", "markdown");
        const result = await stub.callRequest("languages.provideHover", { handle: 0, uri: URI, version: 1 });

        expect(seen.pos?.line).toBe(0);
        expect(seen.pos?.character).toBe(0);
        // The request carried no languageId: the document keeps the mirror's language
        // rather than getting undefined (otherwise selectors would stop matching).
        expect(ctx.registry.get(Uri.parse(URI))?.languageId).toBe("markdown");
        expect(result).toEqual({ contents: ["a single string, not in an array"] });
    });

    it("exactly the provider of the requested handle is called; failing, empty and unknown — null", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const calls: string[] = [];
        const provider = (name: string, answer: () => vscode.ProviderResult<vscode.Hover>): vscode.HoverProvider => ({
            provideHover: () => {
                calls.push(name);
                return answer();
            },
        });
        languages.registerHoverProvider(
            { language: "typescript" },
            provider("throwing", () => {
                throw new Error("boom");
            }),
        );
        languages.registerHoverProvider(
            { language: "typescript" },
            provider("empty", () => null),
        );
        languages.registerHoverProvider(
            { language: "typescript" },
            provider("second", () => new Hover(["from the second", "and more"]) as unknown as vscode.Hover),
        );
        openDoc(ctx);

        expect(await stub.callRequest("languages.provideHover", requestParams({ handle: 2 }))).toEqual({
            contents: ["from the second", "and more"],
        });
        expect(calls).toEqual(["second"]);

        expect(await stub.callRequest("languages.provideHover", requestParams({ handle: 0 }))).toBeNull();
        expect(await stub.callRequest("languages.provideHover", requestParams({ handle: 1 }))).toBeNull();
        expect(calls).toEqual(["second", "throwing", "empty"]);

        const stale = "file:///proj/stale.ts";
        expect(await stub.callRequest("languages.provideHover", requestParams({ handle: 42, uri: stale }))).toBeNull();
        expect(ctx.registry.get(Uri.parse(stale))).toBeUndefined();
        expect(await stub.callRequest("languages.provideHover", requestParams({ handle: undefined }))).toBeNull();
        expect(calls).toHaveLength(3);
    });

    it("a hover with a malformed range is serialized without range; without contents it is dropped entirely", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        languages.registerHoverProvider(
            { language: "typescript" },
            {
                provideHover: () =>
                    ({ contents: ["text"], range: { start: null, end: null } }) as unknown as vscode.Hover,
            },
        );
        languages.registerHoverProvider(
            { language: "typescript" },
            { provideHover: () => ({ contents: [] }) as unknown as vscode.Hover },
        );
        openDoc(ctx);

        expect(await stub.callRequest("languages.provideHover", requestParams())).toEqual({ contents: ["text"] });
        expect(await stub.callRequest("languages.provideHover", requestParams({ handle: 1 }))).toBeNull();
    });

    it("document not open, request stale or ahead of the mirror — null, the provider is not called", async () => {
        const { stub, ctx } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        let calls = 0;
        languages.registerHoverProvider(
            { language: "typescript" },
            {
                provideHover: () => {
                    calls++;
                    return new Hover("present") as unknown as vscode.Hover;
                },
            },
        );

        // Not open: the host hasn't sent didOpen yet (or has already sent didClose).
        expect(await stub.callRequest("languages.provideHover", requestParams())).toBeNull();

        openDoc(ctx);
        ctx.documentSync.change({
            uri: URI,
            version: 2,
            changes: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "x" }],
        });
        // Stale: the core has already moved on to v2.
        expect(await stub.callRequest("languages.provideHover", requestParams({ version: 1 }))).toBeNull();
        // Ahead of the mirror: the v3 edits haven't arrived — an ordering violation, logged to stderr.
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            expect(await stub.callRequest("languages.provideHover", requestParams({ version: 3 }))).toBeNull();
            expect(warn).toHaveBeenCalledTimes(1);
        } finally {
            warn.mockRestore();
        }
        expect(calls).toBe(0);

        expect(await stub.callRequest("languages.provideHover", requestParams({ version: 2 }))).toEqual({
            contents: ["present"],
        });
        expect(calls).toBe(1);
    });
});
