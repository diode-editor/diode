import { afterEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import type {
    ITypeHierarchyItem,
    ITypeHierarchySession,
} from "../../../editor/common/languages/iTypeHierarchySource.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Range, SymbolKind, TypeHierarchyItem, Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

const URI = "file:///proj/main.go";

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
    ctx.documentSync.open({ uri: URI, languageId: "go", version: 1, text: "type Shape interface{}\n" });
    return { stub, languages };
}

function item(name: string): vscode.TypeHierarchyItem {
    const range = new Range(0, 0, 0, 4);
    return new TypeHierarchyItem(
        SymbolKind.Interface,
        name,
        "",
        Uri.parse(URI),
        range,
        range,
    ) as unknown as vscode.TypeHierarchyItem;
}

function provider(overrides: Partial<vscode.TypeHierarchyProvider> = {}): vscode.TypeHierarchyProvider {
    return {
        prepareTypeHierarchy: () => item("root"),
        provideTypeHierarchySupertypes: () => [],
        provideTypeHierarchySubtypes: () => [],
        ...overrides,
    };
}

function prepareParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { handle: 0, uri: URI, languageId: "go", version: 1, line: 3, character: 4, ...overrides };
}

async function prepare(stub: IStubRpc, overrides: Record<string, unknown> = {}): Promise<ITypeHierarchySession> {
    const session = await stub.callRequest("languages.prepareTypeHierarchy", prepareParams(overrides));
    if (session === null) throw new Error("no session");
    return session as ITypeHierarchySession;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("LanguagesNamespace — registerTypeHierarchyProvider", () => {
    it("registration is announced to the core as kind typeHierarchy, dispose removes it", () => {
        const { stub, languages } = makeCtx();
        languages.registerTypeHierarchyProvider("go", provider()).dispose();
        expect(stub.notifies.filter((n) => n.method.startsWith("languages."))).toEqual([
            {
                method: "languages.register",
                params: { handle: 0, kind: "typeHierarchy", selector: [{ language: "go" }] },
            },
            { method: "languages.unregister", params: { handle: 0 } },
        ]);
    });
});

describe("LanguagesNamespace — languages.prepareTypeHierarchy", () => {
    it("asks the provider of the handle with the document and the position", async () => {
        const { stub, languages } = makeCtx();
        const other = vi.fn(() => item("other"));
        const prepareRoot = vi.fn(() => item("root"));
        languages.registerTypeHierarchyProvider("go", provider({ prepareTypeHierarchy: other }));
        languages.registerTypeHierarchyProvider("go", provider({ prepareTypeHierarchy: prepareRoot }));

        const session = await prepare(stub, { handle: 1 });

        expect(session.items.map((i) => i.name)).toEqual(["root"]);
        expect(other).not.toHaveBeenCalled();
        const [document, position] = prepareRoot.mock.calls[0] as unknown as [vscode.TextDocument, vscode.Position];
        expect(document.uri.toString()).toBe(URI);
        expect([position.line, position.character]).toEqual([3, 4]);
    });

    it("an unknown or missing handle, an unsynced document: no session, the provider isn't asked", async () => {
        const { stub, languages } = makeCtx();
        const first = vi.fn(() => item("first"));
        languages.registerTypeHierarchyProvider("go", provider());
        languages.registerTypeHierarchyProvider("go", provider({ prepareTypeHierarchy: first }));
        const call = (overrides: Record<string, unknown>): Promise<unknown> =>
            stub.callRequest("languages.prepareTypeHierarchy", prepareParams(overrides));

        expect(await call({ handle: 9 })).toBeNull();
        expect(await call({ handle: undefined })).toBeNull();
        expect(await call({ handle: 1, version: 7 })).toBeNull();
        expect(first).not.toHaveBeenCalled();
    });

    it("a failing provider answers nothing and reports to the log under its name", async () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { stub, languages } = makeCtx();
        languages.registerTypeHierarchyProvider(
            "go",
            provider({
                prepareTypeHierarchy: () => {
                    throw new Error("boom");
                },
            }),
        );
        expect(await stub.callRequest("languages.prepareTypeHierarchy", prepareParams())).toBeNull();
        expect(errors).toHaveBeenCalledWith(expect.stringContaining("prepareTypeHierarchy failed"));
    });

    it("a missing position counts as the start of the document", async () => {
        const { stub, languages } = makeCtx();
        const prepareRoot = vi.fn(() => item("root"));
        languages.registerTypeHierarchyProvider("go", provider({ prepareTypeHierarchy: prepareRoot }));
        await prepare(stub, { line: undefined, character: undefined });
        const position = (prepareRoot.mock.calls[0] as unknown as [unknown, vscode.Position])[1];
        expect([position.line, position.character]).toEqual([0, 0]);
    });
});

describe.each([
    {
        method: "languages.provideTypeHierarchySupertypes",
        providerMember: "provideTypeHierarchySupertypes",
        otherMember: "provideTypeHierarchySubtypes",
    },
    {
        method: "languages.provideTypeHierarchySubtypes",
        providerMember: "provideTypeHierarchySubtypes",
        otherMember: "provideTypeHierarchySupertypes",
    },
] as const)("LanguagesNamespace — $method", ({ method, providerMember, otherMember }) => {
    function setup(answer: () => unknown = () => [item("next")]) {
        const { stub, languages } = makeCtx();
        const root = item("root");
        const ask = vi.fn(answer);
        const otherDirection = vi.fn(() => []);
        // Handle 0 is a decoy: the request has to reach the provider of its own handle.
        languages.registerTypeHierarchyProvider("go", provider());
        languages.registerTypeHierarchyProvider(
            "go",
            provider({
                prepareTypeHierarchy: () => root,
                [providerMember]: ask,
                [otherMember]: otherDirection,
            }),
        );
        return { stub, root, ask, otherDirection };
    }

    it("the provider of the direction gets its own object, the answer goes through the session", async () => {
        const { stub, root, ask, otherDirection } = setup();
        const { sessionId, items } = await prepare(stub, { handle: 1 });

        const types = (await stub.callRequest(method, {
            handle: 1,
            sessionId,
            itemId: items[0].itemId,
        })) as ITypeHierarchyItem[];

        expect(ask.mock.calls[0]).toContain(root);
        expect(otherDirection).not.toHaveBeenCalled();
        expect(types.map((type) => type.name)).toEqual(["next"]);
    });

    it("an unknown or missing handle answers nothing and asks nobody", async () => {
        const { stub, ask } = setup();
        const { sessionId, items } = await prepare(stub, { handle: 1 });
        const { itemId } = items[0];

        expect(await stub.callRequest(method, { handle: 9, sessionId, itemId })).toEqual([]);
        expect(await stub.callRequest(method, { sessionId, itemId })).toEqual([]);
        expect(ask).not.toHaveBeenCalled();
    });

    it("a missing session or item is `missing type hierarchy item` in the log, not a failure", async () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { stub, ask } = setup();
        const { sessionId, items } = await prepare(stub, { handle: 1 });

        expect(await stub.callRequest(method, { handle: 1, itemId: items[0].itemId })).toEqual([]);
        expect(await stub.callRequest(method, { handle: 1, sessionId })).toEqual([]);
        expect(ask).not.toHaveBeenCalled();
        expect(errors).toHaveBeenCalledTimes(2);
        expect(errors).toHaveBeenCalledWith(
            expect.stringMatching(new RegExp(`${providerMember} failed.*missing type hierarchy item`, "s")),
        );
    });

    it("a failing provider answers nothing and reports under its name", async () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { stub } = setup(() => {
            throw new Error("boom");
        });
        const { sessionId, items } = await prepare(stub, { handle: 1 });
        expect(await stub.callRequest(method, { handle: 1, sessionId, itemId: items[0].itemId })).toEqual([]);
        expect(errors).toHaveBeenCalledWith(expect.stringContaining(`${providerMember} failed`));
    });

    it("after release the item is gone; a release without a session or handle touches nothing", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { stub, ask } = setup();
        const { sessionId, items } = await prepare(stub, { handle: 1 });
        const params = { handle: 1, sessionId, itemId: items[0].itemId };

        stub.fire("languages.releaseTypeHierarchy", { handle: 1 });
        stub.fire("languages.releaseTypeHierarchy", { sessionId });
        stub.fire("languages.releaseTypeHierarchy", null);
        await stub.callRequest(method, params);
        expect(ask).toHaveBeenCalledTimes(1);

        stub.fire("languages.releaseTypeHierarchy", { handle: 1, sessionId });
        expect(await stub.callRequest(method, params)).toEqual([]);
        expect(ask).toHaveBeenCalledTimes(1);
    });
});
