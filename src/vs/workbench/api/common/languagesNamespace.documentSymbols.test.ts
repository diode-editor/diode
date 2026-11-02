import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { serializeDocumentSymbols } from "./extHostTypeConverters.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { DocumentSymbol, Location, Range, SymbolInformation, SymbolKind, SymbolTag, Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

const URI = "file:///proj/main.ts";
const FILE = Uri.file("/proj/main.ts");

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
    ctx.documentSync.open({ uri: URI, languageId: "typescript", version: 1, text: "class A {}\n" });
    return { ctx, stub };
}

const params = (handle = 0) => ({ handle, uri: URI, languageId: "typescript", version: 1 });
const wire = (a: number, b: number, c: number, d: number) => ({
    start: { line: a, character: b },
    end: { line: c, character: d },
});

function info(name: string, kind: SymbolKind, range: Range, container = ""): SymbolInformation {
    return new SymbolInformation(name, kind, container, new Location(FILE, range));
}

describe("LanguagesNamespace — registerDocumentSymbolProvider", () => {
    it("is announced under its own kind, metadata stays out of the wire, dispose removes it", () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const sent = () => stub.notifies.filter((n) => n.method.startsWith("languages."));

        const registration = languages.registerDocumentSymbolProvider(
            { language: "typescript" },
            { provideDocumentSymbols: () => [] },
            { label: "outline" },
        );

        expect(sent()).toEqual([
            {
                method: "languages.register",
                params: { handle: 0, kind: "documentSymbol", selector: [{ language: "typescript" }] },
            },
        ]);
        registration.dispose();
        expect(sent().slice(1)).toEqual([{ method: "languages.unregister", params: { handle: 0 } }]);
    });
});

describe("LanguagesNamespace — languages.provideDocumentSymbols", () => {
    it("the provider gets the mirrored document; its tree comes back on the wire", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const seen: vscode.TextDocument[] = [];
        languages.registerDocumentSymbolProvider(
            { language: "typescript" },
            {
                provideDocumentSymbols: (document) => {
                    seen.push(document);
                    return [
                        new DocumentSymbol("A", "", SymbolKind.Class, new Range(0, 0, 0, 10), new Range(0, 6, 0, 7)),
                    ] as unknown as vscode.DocumentSymbol[];
                },
            },
        );

        const result = await stub.callRequest("languages.provideDocumentSymbols", params());

        expect(seen[0].getText()).toBe("class A {}\n");
        expect(result).toEqual([
            {
                name: "A",
                detail: "",
                kind: SymbolKind.Class,
                tags: [],
                range: wire(0, 0, 0, 10),
                selectionRange: wire(0, 6, 0, 7),
                children: [],
            },
        ]);
    });

    it("the handle picks the provider; a request without one asks nobody", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const first = vi.fn(() => []);
        const second = vi.fn(() => []);
        languages.registerDocumentSymbolProvider({ language: "typescript" }, { provideDocumentSymbols: first });
        languages.registerDocumentSymbolProvider({ language: "typescript" }, { provideDocumentSymbols: second });

        await stub.callRequest("languages.provideDocumentSymbols", { ...params(), handle: undefined });
        expect(second).not.toHaveBeenCalled();
        await stub.callRequest("languages.provideDocumentSymbols", params(1));
        expect(second).toHaveBeenCalledTimes(1);
        expect(first).not.toHaveBeenCalled();
    });

    it("an unknown handle or an unsynced document answers empty without asking", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const provideDocumentSymbols = vi.fn(() => []);
        languages.registerDocumentSymbolProvider({ language: "typescript" }, { provideDocumentSymbols });

        expect(await stub.callRequest("languages.provideDocumentSymbols", params(5))).toEqual([]);
        expect(
            await stub.callRequest("languages.provideDocumentSymbols", { ...params(), uri: "file:///other.ts" }),
        ).toEqual([]);
        expect(provideDocumentSymbols).not.toHaveBeenCalled();
    });

    it("the handle picks the provider; without one nobody is asked", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const asked = [vi.fn(() => []), vi.fn(() => [])];
        for (const provideDocumentSymbols of asked) {
            languages.registerDocumentSymbolProvider({ language: "typescript" }, { provideDocumentSymbols });
        }

        await stub.callRequest("languages.provideDocumentSymbols", { ...params(), handle: undefined });
        expect(asked.map((fn) => fn.mock.calls.length)).toEqual([0, 0]);
        await stub.callRequest("languages.provideDocumentSymbols", params(1));
        expect(asked.map((fn) => fn.mock.calls.length)).toEqual([0, 1]);
    });

    it("a throwing provider answers empty and is reported", async () => {
        const { ctx, stub } = makeCtx();
        const { languages } = createLanguagesNamespace(ctx);
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        languages.registerDocumentSymbolProvider(
            { language: "typescript" },
            {
                provideDocumentSymbols: () => {
                    throw new Error("boom");
                },
            },
        );

        expect(await stub.callRequest("languages.provideDocumentSymbols", params())).toEqual([]);
        expect(errors.mock.calls.flat().join(" ")).toContain("provideDocumentSymbols failed: ");
        errors.mockRestore();
    });
});

describe("serializeDocumentSymbols", () => {
    it.each([[undefined], [null], ["x"], [[]]])("%j answers nothing", (raw) => {
        expect(serializeDocumentSymbols(raw)).toEqual([]);
    });

    it("keeps detail, tags and nested children, dropping malformed entries at any depth", () => {
        const parent = new DocumentSymbol("P", "d", SymbolKind.Class, new Range(0, 0, 5, 0), new Range(0, 0, 0, 1));
        parent.tags = [SymbolTag.Deprecated];
        const child = new DocumentSymbol("c", "", SymbolKind.Method, new Range(1, 0, 2, 0), new Range(1, 0, 1, 1));
        parent.children = [child, { name: "broken" } as unknown as DocumentSymbol];

        const [symbol, ...rest] = serializeDocumentSymbols([parent, { name: "no ranges" }]);

        expect(rest).toEqual([]);
        expect(symbol.detail).toBe("d");
        expect(symbol.tags).toEqual([SymbolTag.Deprecated]);
        expect(symbol.children.map((entry) => entry.name)).toEqual(["c"]);
    });

    it("tolerates a JS provider's odd fields", () => {
        const [symbol] = serializeDocumentSymbols([
            {
                name: "n",
                detail: 1,
                kind: SymbolKind.Key,
                tags: ["x", 1],
                range: new Range(0, 0, 0, 1),
                selectionRange: new Range(0, 0, 0, 1),
            },
        ]);
        expect(symbol).toMatchObject({ detail: "", tags: [1], children: [] });
        expect(
            serializeDocumentSymbols([
                { name: 1, range: new Range(0, 0, 0, 1), selectionRange: new Range(0, 0, 0, 1) },
            ]),
        ).toEqual([]);
    });

    it.each([
        ["range", { selectionRange: new Range(0, 0, 0, 1) }],
        ["selectionRange", { range: new Range(0, 0, 0, 1) }],
    ])("a symbol without its %s is dropped", (_missing, ranges) => {
        expect(serializeDocumentSymbols([{ name: "n", ...ranges }])).toEqual([]);
    });

    it("a symbol ending where its parent ends is its child", () => {
        const roots = serializeDocumentSymbols([
            info("outer", SymbolKind.Class, new Range(0, 0, 5, 0)),
            info("tail", SymbolKind.Method, new Range(2, 0, 5, 0)),
        ]);
        expect(roots.map((symbol) => symbol.name)).toEqual(["outer"]);
        expect(roots[0].children.map((symbol) => symbol.name)).toEqual(["tail"]);
        expect(roots[0].detail).toBe("");
    });

    it("SymbolInformation nests by strict containment, whatever the input order", () => {
        const roots = serializeDocumentSymbols([
            info("inner", SymbolKind.Variable, new Range(2, 0, 3, 0)),
            info("sameRange", SymbolKind.Class, new Range(0, 0, 9, 0)),
            info("outer", SymbolKind.Class, new Range(0, 0, 9, 0), "ns"),
            info("middle", SymbolKind.Method, new Range(1, 0, 4, 0)),
            info("sibling", SymbolKind.Method, new Range(5, 0, 6, 0)),
            info("after", SymbolKind.Function, new Range(10, 0, 11, 0)),
        ]);

        expect(roots.map((symbol) => symbol.name)).toEqual(["sameRange", "outer", "after"]);
        const outer = roots[1];
        expect(outer.containerName).toBe("ns");
        expect(outer.selectionRange).toEqual(outer.range);
        expect(outer.children.map((symbol) => symbol.name)).toEqual(["middle", "sibling"]);
        expect(outer.children[0].children.map((symbol) => symbol.name)).toEqual(["inner"]);
    });

    it("the longer range goes first at one start, and overlap without containment stays a sibling", () => {
        const roots = serializeDocumentSymbols([
            info("short", SymbolKind.Variable, new Range(0, 0, 1, 0)),
            info("long", SymbolKind.Class, new Range(0, 0, 5, 0)),
            info("overlap", SymbolKind.Variable, new Range(4, 0, 8, 0)),
        ]);
        expect(roots.map((symbol) => symbol.name)).toEqual(["long", "overlap"]);
        expect(roots[0].children.map((symbol) => symbol.name)).toEqual(["short"]);
    });

    it("a missing name, tags and a malformed location are handled as upstream", () => {
        const noName = info("x", SymbolKind.Key, new Range(0, 0, 0, 1));
        noName.name = "";
        noName.tags = [SymbolTag.Deprecated];
        const roots = serializeDocumentSymbols([noName, { name: "bad", location: {} }]);
        expect(roots).toHaveLength(1);
        expect(roots[0].name).toBe("!!MISSING: name!!");
        expect(roots[0].tags).toEqual([SymbolTag.Deprecated]);
    });
});

describe("SymbolInformation", () => {
    it("the location constructor keeps the container and the location", () => {
        const location = new Location(FILE, new Range(1, 0, 2, 0));
        const symbol = new SymbolInformation("n", SymbolKind.Key, "box", location);
        expect(symbol.containerName).toBe("box");
        expect(symbol.location).toBe(location);
    });

    it("the deprecated range constructor builds a location", () => {
        const range = new Range(1, 0, 2, 0);
        const symbol = new SymbolInformation("n", SymbolKind.Key, range, FILE, "box");
        expect(symbol.containerName).toBe("box");
        expect(symbol.location.uri).toBe(FILE);
        expect(symbol.location.range).toBe(range);
        expect(new SymbolInformation("n", SymbolKind.Key, range).containerName).toBe("");
    });

    it("an empty name throws, as upstream", () => {
        expect(() => new SymbolInformation("", SymbolKind.Key, new Range(0, 0, 0, 0))).toThrow(
            "name must not be falsy",
        );
    });
});
