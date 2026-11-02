import { afterEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Location, Range, SymbolInformation, SymbolKind, SymbolTag, Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

const FILE = Uri.file("/proj/main.ts");
const FILE_URI = "file:///proj/main.ts";
const wire = (a: number, b: number, c: number, d: number) => ({
    start: { line: a, character: b },
    end: { line: c, character: d },
});

function setup() {
    const stub = makeStubRpc();
    const registry = new DocumentRegistry();
    const owner = new ExtensionOwner();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner,
    };
    const { languages } = createLanguagesNamespace(ctx);
    const provide = (handle: number, query: string) =>
        stub.callRequest("languages.provideWorkspaceSymbols", { handle, query }) as Promise<{
            cacheId: number;
            symbols: { id: number; name: string }[];
        }>;
    const resolve = (handle: number, cacheId: number, id: number) =>
        stub.callRequest("languages.resolveWorkspaceSymbol", { handle, cacheId, id });
    return { stub, languages, provide, resolve, owner };
}

function info(name: string, line = 1): SymbolInformation {
    return new SymbolInformation(name, SymbolKind.Function, "", new Location(FILE, new Range(line, 0, line, 3)));
}

const provider = (answer: unknown): vscode.WorkspaceSymbolProvider => ({
    provideWorkspaceSymbols: () => answer as vscode.SymbolInformation[],
});

describe("LanguagesNamespace — registerWorkspaceSymbolProvider", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("is announced without a selector, saying whether it resolves; dispose removes it once", () => {
        const { stub, languages } = setup();
        const sent = () => stub.notifies.filter((n) => n.method.startsWith("languages."));

        const plain = languages.registerWorkspaceSymbolProvider(provider([]));
        languages.registerWorkspaceSymbolProvider({
            provideWorkspaceSymbols: () => [],
            resolveWorkspaceSymbol: (symbol) => symbol,
        });

        expect(sent()).toEqual([
            { method: "languages.registerWorkspaceSymbol", params: { handle: 0, supportsResolve: false } },
            { method: "languages.registerWorkspaceSymbol", params: { handle: 1, supportsResolve: true } },
        ]);

        plain.dispose();
        plain.dispose();
        expect(sent().slice(2)).toEqual([{ method: "languages.unregister", params: { handle: 0 } }]);
    });

    it("the query reaches the provider, the answer carries everything the row needs", async () => {
        const { languages, provide } = setup();
        const symbol = new SymbolInformation(
            "foo",
            SymbolKind.Class,
            "Container",
            new Location(FILE, new Range(1, 2, 3, 4)),
        );
        symbol.tags = [SymbolTag.Deprecated];
        const provideWorkspaceSymbols = vi.fn(() => [symbol]);
        languages.registerWorkspaceSymbolProvider({ provideWorkspaceSymbols });

        const answer = await provide(0, "fo");

        expect(provideWorkspaceSymbols.mock.calls[0]).toContain("fo");
        expect(answer.symbols).toEqual([
            {
                id: 0,
                name: "foo",
                kind: SymbolKind.Class,
                tags: [SymbolTag.Deprecated],
                containerName: "Container",
                location: { uri: FILE_URI, range: wire(1, 2, 3, 4) },
            },
        ]);
    });

    it("a partial location has no range; no container means no field", async () => {
        const { languages, provide } = setup();
        const partial = { name: "foo", kind: SymbolKind.Class, location: { uri: FILE } };
        languages.registerWorkspaceSymbolProvider(provider([partial]));

        const answer = await provide(0, "");

        expect(answer.symbols).toEqual([
            { id: 0, name: "foo", kind: SymbolKind.Class, tags: [], location: { uri: FILE_URI } },
        ]);
    });

    it("a symbol without a name is dropped with a warning naming the extension; the ids stay addresses", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const { languages, provide, owner } = setup();
        owner.runAs("pub.ext", () =>
            languages.registerWorkspaceSymbolProvider(
                provider([{ kind: SymbolKind.Class, location: { uri: FILE } }, null, info("kept")]),
            ),
        );

        const answer = await provide(0, "");

        expect(answer.symbols.map(({ id, name }) => ({ id, name }))).toEqual([{ id: 2, name: "kept" }]);
        expect(warn).toHaveBeenCalledTimes(2);
        expect(warn.mock.calls[0][0]).toContain("[pub.ext] INVALID SymbolInformation");
    });

    it("a symbol without a location to open is dropped too, the rest of the answer stands", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { languages, provide } = setup();
        languages.registerWorkspaceSymbolProvider(provider([{ name: "foo", kind: SymbolKind.Class }, info("kept")]));

        expect((await provide(0, "")).symbols.map((symbol) => symbol.name)).toEqual(["kept"]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(error).not.toHaveBeenCalled();
    });

    it.each([
        ["undefined", undefined],
        ["null", null],
        ["an empty array", []],
        ["not an array", { name: "foo" }],
    ])("the provider answers %s: empty", async (_name, value) => {
        const { languages, provide } = setup();
        languages.registerWorkspaceSymbolProvider(provider(value));
        expect(await provide(0, "")).toEqual({ cacheId: 0, symbols: [] });
    });

    it("an unknown handle and a failing provider answer empty; the failure is reported", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { languages, provide } = setup();
        languages.registerWorkspaceSymbolProvider({
            provideWorkspaceSymbols: () => {
                throw new Error("boom");
            },
        });

        expect(await provide(9, "")).toEqual({ cacheId: 0, symbols: [] });
        expect(await provide(0, "")).toEqual({ cacheId: 0, symbols: [] });
        expect(error.mock.calls[0][0]).toContain("provideWorkspaceSymbols failed: ");
    });

    describe("resolve", () => {
        function resolving() {
            const resolveWorkspaceSymbol = vi.fn((symbol: SymbolInformation) => {
                symbol.location = new Location(FILE, new Range(7, 0, 7, 3));
                return symbol;
            });
            const fixture = setup();
            fixture.languages.registerWorkspaceSymbolProvider({
                provideWorkspaceSymbols: (query) => [info(`${query}0`), info(`${query}1`)],
                resolveWorkspaceSymbol,
            });
            return { ...fixture, resolveWorkspaceSymbol };
        }

        it("gets the very object the provider returned and answers its location", async () => {
            const original = info("foo");
            const resolveWorkspaceSymbol = vi.fn((symbol: SymbolInformation) => symbol);
            const { languages, provide, resolve } = setup();
            languages.registerWorkspaceSymbolProvider({
                provideWorkspaceSymbols: () => [original],
                resolveWorkspaceSymbol,
            });

            const { cacheId } = await provide(0, "");
            const answer = await resolve(0, cacheId, 0);

            expect(resolveWorkspaceSymbol.mock.calls[0]).toContain(original);
            expect(answer).toEqual({ location: { uri: FILE_URI, range: wire(1, 0, 1, 3) } });
        });

        it("the id picks the symbol inside its answer", async () => {
            const { provide, resolve, resolveWorkspaceSymbol } = resolving();
            const { cacheId } = await provide(0, "q");
            await resolve(0, cacheId, 1);
            expect(resolveWorkspaceSymbol.mock.calls[0][0].name).toBe("q1");
        });

        it("the cache is two answers deep: the one before the previous is gone", async () => {
            const { provide, resolve, resolveWorkspaceSymbol } = resolving();
            const first = await provide(0, "a");
            const second = await provide(0, "b");
            const third = await provide(0, "c");

            expect(await resolve(0, first.cacheId, 0)).toBeNull();
            expect(resolveWorkspaceSymbol).not.toHaveBeenCalled();
            expect(await resolve(0, second.cacheId, 0)).not.toBeNull();
            expect(await resolve(0, third.cacheId, 0)).not.toBeNull();
        });

        it("the depth is per provider: answers of another one do not evict", async () => {
            const { languages, provide, resolve } = resolving();
            languages.registerWorkspaceSymbolProvider(provider([info("other")]));
            const mine = await provide(0, "a");
            await provide(1, "x");
            await provide(1, "y");
            await provide(1, "z");

            expect(await resolve(0, mine.cacheId, 0)).not.toBeNull();
        });

        it("a cache id of one provider means nothing to another", async () => {
            const { languages, provide, resolve } = resolving();
            languages.registerWorkspaceSymbolProvider({
                provideWorkspaceSymbols: () => [info("other")],
                resolveWorkspaceSymbol: (symbol) => symbol,
            });
            const mine = await provide(0, "a");
            expect(await resolve(1, mine.cacheId, 0)).toBeNull();
        });

        it("an empty answer takes no place in the cache", async () => {
            const { languages, provide, resolve } = setup();
            let answer: SymbolInformation[] = [info("foo")];
            languages.registerWorkspaceSymbolProvider({
                provideWorkspaceSymbols: () => answer,
                resolveWorkspaceSymbol: (symbol) => symbol,
            });
            const kept = await provide(0, "");
            answer = [];
            await provide(0, "");
            await provide(0, "");
            expect(await resolve(0, kept.cacheId, 0)).not.toBeNull();
        });

        it("nothing to resolve with: unknown handle, id, or the provider gave nothing; that is no failure", async () => {
            const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
            const { languages, provide, resolve } = setup();
            languages.registerWorkspaceSymbolProvider({
                provideWorkspaceSymbols: () => [info("foo")],
                resolveWorkspaceSymbol: () => undefined,
            });
            const { cacheId } = await provide(0, "");

            expect(await resolve(5, cacheId, 0)).toBeNull();
            expect(await resolve(0, cacheId, 9)).toBeNull();
            expect(await resolve(0, cacheId, 0)).toBeNull();
            expect(error).not.toHaveBeenCalled();
        });

        it("a failing resolve answers null and is reported", async () => {
            const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
            const { languages, provide, resolve } = setup();
            languages.registerWorkspaceSymbolProvider({
                provideWorkspaceSymbols: () => [info("foo")],
                resolveWorkspaceSymbol: () => {
                    throw new Error("boom");
                },
            });
            const { cacheId } = await provide(0, "");

            expect(await resolve(0, cacheId, 0)).toBeNull();
            expect(error.mock.calls[0][0]).toContain("resolveWorkspaceSymbol failed: ");
        });
    });
});
