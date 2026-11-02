import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { Uri } from "../../../base/common/uri.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { DocumentLink, Range } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

const URI = "file:///proj/main.go";
const OTHER_URI = "file:///proj/other.go";
const PROVIDE = "languages.provideDocumentLinks";
const RESOLVE = "languages.resolveDocumentLink";
const WIRE_RANGE = { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } };

function makeCtx(): { stub: IStubRpc; languages: typeof vscode.languages; sync: (version: number) => void } {
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
    ctx.documentSync.open({ uri: URI, languageId: "go", version: 1, text: "import x\n" });
    ctx.documentSync.open({ uri: OTHER_URI, languageId: "go", version: 1, text: "other\n" });
    const sync = (version: number): void => {
        ctx.documentSync.open({ uri: URI, languageId: "go", version, text: `import x // ${String(version)}\n` });
    };
    return { stub, languages, sync };
}

function params(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { handle: 0, uri: URI, languageId: "go", version: 1, ...overrides };
}

function link(target?: string): DocumentLink {
    return new DocumentLink(new Range(0, 1, 0, 4), target === undefined ? undefined : Uri.parse(target));
}

interface IList {
    readonly cacheId: number;
}

describe("LanguagesNamespace — registerDocumentLinkProvider", () => {
    it("registration is announced with hasResolve, dispose removes it", () => {
        const { stub, languages } = makeCtx();
        languages
            .registerDocumentLinkProvider("go", {
                provideDocumentLinks: () => [],
                resolveDocumentLink: (item) => item,
            })
            .dispose();
        languages.registerDocumentLinkProvider("go", { provideDocumentLinks: () => [] });
        expect(stub.notifies.filter((n) => n.method.startsWith("languages."))).toEqual([
            {
                method: "languages.register",
                params: { handle: 0, kind: "documentLink", selector: [{ language: "go" }], hasResolve: true },
            },
            { method: "languages.unregister", params: { handle: 0 } },
            {
                method: "languages.register",
                params: { handle: 1, kind: "documentLink", selector: [{ language: "go" }], hasResolve: false },
            },
        ]);
    });

    it("the provider gets the synced document; the list goes over the wire with its ids", async () => {
        const { stub, languages } = makeCtx();
        const provide = vi.fn((_document: vscode.TextDocument) => {
            const withTooltip = link("https://a.b/c#L1");
            withTooltip.tooltip = "tip";
            return [withTooltip, link()];
        });
        languages.registerDocumentLinkProvider("go", {
            provideDocumentLinks: provide as vscode.DocumentLinkProvider["provideDocumentLinks"],
        });

        const list = await stub.callRequest(PROVIDE, params());

        expect(provide.mock.calls[0][0].uri.toString()).toBe(URI);
        expect(list).toEqual({
            cacheId: expect.any(Number) as number,
            links: [
                { id: 0, range: WIRE_RANGE, target: "https://a.b/c#L1", tooltip: "tip" },
                { id: 1, range: WIRE_RANGE },
            ],
        });
    });

    it("a broken entry is dropped, and the ids still find the provider's own objects", async () => {
        const { stub, languages } = makeCtx();
        const good = link();
        const resolve = vi.fn((item: vscode.DocumentLink) => item);
        languages.registerDocumentLinkProvider("go", {
            provideDocumentLinks: () =>
                [null, { range: "nope" }, { range: new Range(0, 0, 0, 1), target: "not a uri" }, good] as never,
            resolveDocumentLink: resolve as vscode.DocumentLinkProvider["resolveDocumentLink"],
        });
        const list = (await stub.callRequest(PROVIDE, params())) as IList & { links: { id: number }[] };
        expect(list.links.map((item) => item.id)).toEqual([0]);

        await stub.callRequest(RESOLVE, { handle: 0, cacheId: list.cacheId, id: 0 });
        expect(resolve.mock.calls[0][0]).toBe(good);
    });

    it("a target goes over the wire as a url: what it needs literally is not encoded", async () => {
        const { stub, languages } = makeCtx();
        const target = "https://a.b/x@v1?k=v&l=a,b#frag";
        languages.registerDocumentLinkProvider("go", { provideDocumentLinks: () => [link(target)] });
        const list = (await stub.callRequest(PROVIDE, params())) as { links: { target: string }[] };
        expect(list.links[0].target).toBe(target);
    });

    it("a tooltip that is not a string is not sent", async () => {
        const { stub, languages } = makeCtx();
        const odd = Object.assign(link(), { tooltip: 5 });
        languages.registerDocumentLinkProvider("go", { provideDocumentLinks: () => [odd] as never });
        const list = (await stub.callRequest(PROVIDE, params())) as { links: unknown[] };
        expect(list.links).toEqual([{ id: 0, range: WIRE_RANGE }]);
    });

    it.each([
        ["undefined", undefined],
        ["null", null],
        ["not an array", 5],
    ])("%s is an empty list", async (_name, answer) => {
        const { stub, languages } = makeCtx();
        languages.registerDocumentLinkProvider("go", { provideDocumentLinks: () => answer as never });
        expect(await stub.callRequest(PROVIDE, params())).toMatchObject({ links: [] });
    });

    it("a provider failure is an empty list", async () => {
        const { stub, languages } = makeCtx();
        languages.registerDocumentLinkProvider("go", {
            provideDocumentLinks: () => {
                throw new Error("boom");
            },
        });
        expect(await stub.callRequest(PROVIDE, params())).toMatchObject({ links: [] });
    });

    it("an unknown provider or an unsynced document is null", async () => {
        const { stub, languages } = makeCtx();
        expect(await stub.callRequest(PROVIDE, params())).toBeNull();
        languages.registerDocumentLinkProvider("go", { provideDocumentLinks: () => [] });
        expect(await stub.callRequest(PROVIDE, params({ handle: 9 }))).toBeNull();
        expect(await stub.callRequest(PROVIDE, params({ uri: "file:///nope.go" }))).toBeNull();
    });

    describe("resolveDocumentLink", () => {
        function withResolve(
            languages: typeof vscode.languages,
            resolve: (item: vscode.DocumentLink) => unknown,
        ): vscode.Disposable {
            return languages.registerDocumentLinkProvider("go", {
                provideDocumentLinks: () => [link()],
                resolveDocumentLink: resolve as vscode.DocumentLinkProvider["resolveDocumentLink"],
            });
        }

        it("the target of the returned link", async () => {
            const { stub, languages } = makeCtx();
            withResolve(languages, () => link("https://resolved/"));
            const { cacheId } = (await stub.callRequest(PROVIDE, params())) as IList;
            expect(await stub.callRequest(RESOLVE, { handle: 0, cacheId, id: 0 })).toBe("https://resolved/");
        });

        it("no answer: the target the provider set on its own object", async () => {
            const { stub, languages } = makeCtx();
            withResolve(languages, (item) => {
                item.target = Uri.parse("https://mutated/");
                return undefined;
            });
            const { cacheId } = (await stub.callRequest(PROVIDE, params())) as IList;
            expect(await stub.callRequest(RESOLVE, { handle: 0, cacheId, id: 0 })).toBe("https://mutated/");
        });

        it("no target at all, a provider without the method, a failure: null", async () => {
            const { stub, languages } = makeCtx();
            withResolve(languages, () => undefined);
            languages.registerDocumentLinkProvider("go", { provideDocumentLinks: () => [link()] });
            withResolve(languages, () => {
                throw new Error("boom");
            });
            for (const handle of [0, 1, 2]) {
                const { cacheId } = (await stub.callRequest(PROVIDE, params({ handle }))) as IList;
                expect(await stub.callRequest(RESOLVE, { handle, cacheId, id: 0 })).toBeNull();
            }
        });

        it("an unknown handle, list or id is null", async () => {
            const { stub, languages } = makeCtx();
            withResolve(languages, () => link("https://resolved/"));
            const { cacheId } = (await stub.callRequest(PROVIDE, params())) as IList;
            expect(await stub.callRequest(RESOLVE, { handle: 9, cacheId, id: 0 })).toBeNull();
            expect(await stub.callRequest(RESOLVE, { handle: 0, cacheId: 999, id: 0 })).toBeNull();
            expect(await stub.callRequest(RESOLVE, { handle: 0, cacheId, id: 5 })).toBeNull();
            expect(await stub.callRequest(RESOLVE, null)).toBeNull();
        });

        it("the lists of one version all stay: every split of a document holds its own", async () => {
            const { stub, languages } = makeCtx();
            withResolve(languages, () => link("https://resolved/"));
            const lists = [
                (await stub.callRequest(PROVIDE, params())) as IList,
                (await stub.callRequest(PROVIDE, params())) as IList,
                (await stub.callRequest(PROVIDE, params())) as IList,
            ];
            for (const { cacheId } of lists) {
                expect(await stub.callRequest(RESOLVE, { handle: 0, cacheId, id: 0 })).toBe("https://resolved/");
            }
        });

        it("depth 2 in versions: the third version evicts the first, the other document's survives", async () => {
            const { stub, languages, sync } = makeCtx();
            withResolve(languages, () => link("https://resolved/"));
            const other = (await stub.callRequest(PROVIDE, params({ uri: OTHER_URI }))) as IList;
            sync(1);
            const first = (await stub.callRequest(PROVIDE, params({ version: 1 }))) as IList;
            sync(2);
            const second = (await stub.callRequest(PROVIDE, params({ version: 2 }))) as IList;
            sync(3);
            const third = (await stub.callRequest(PROVIDE, params({ version: 3 }))) as IList;
            const ask = (cacheId: number) => stub.callRequest(RESOLVE, { handle: 0, cacheId, id: 0 });

            expect(await ask(first.cacheId)).toBeNull();
            expect(await ask(second.cacheId)).toBe("https://resolved/");
            expect(await ask(third.cacheId)).toBe("https://resolved/");
            expect(await ask(other.cacheId)).toBe("https://resolved/");
        });

        it("depth 2 per provider: another provider's lists do not evict these", async () => {
            const { stub, languages, sync } = makeCtx();
            withResolve(languages, () => link("https://resolved/"));
            withResolve(languages, () => link("https://resolved/"));
            const mine = (await stub.callRequest(PROVIDE, params({ handle: 0 }))) as IList;
            sync(1);
            await stub.callRequest(PROVIDE, params({ handle: 1, version: 1 }));
            sync(2);
            await stub.callRequest(PROVIDE, params({ handle: 1, version: 2 }));
            sync(3);
            await stub.callRequest(PROVIDE, params({ handle: 1, version: 3 }));
            expect(await stub.callRequest(RESOLVE, { handle: 0, cacheId: mine.cacheId, id: 0 })).toBe(
                "https://resolved/",
            );
        });

        it("dispose frees only that provider's lists", async () => {
            const { stub, languages } = makeCtx();
            const gone = withResolve(languages, () => link("https://resolved/"));
            withResolve(languages, () => link("https://resolved/"));
            const mine = (await stub.callRequest(PROVIDE, params({ handle: 0 }))) as IList;
            const others = (await stub.callRequest(PROVIDE, params({ handle: 1 }))) as IList;
            gone.dispose();
            expect(await stub.callRequest(RESOLVE, { handle: 0, cacheId: mine.cacheId, id: 0 })).toBeNull();
            expect(await stub.callRequest(RESOLVE, { handle: 1, cacheId: others.cacheId, id: 0 })).toBe(
                "https://resolved/",
            );
        });
    });
});
