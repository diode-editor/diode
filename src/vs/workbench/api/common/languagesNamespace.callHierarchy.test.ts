import { afterEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createRange } from "../../../editor/common/core/iRange.ts";
import type {
    ICallHierarchyIncomingCall,
    ICallHierarchyOutgoingCall,
    ICallHierarchySession,
} from "../../../editor/common/languages/iCallHierarchySource.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { CallHierarchyIncomingCall, CallHierarchyOutgoingCall } from "./vscodeCallHierarchyTypes.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { CallHierarchyItem, Range, SymbolKind, Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

const URI = "file:///proj/main.ts";

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
    ctx.documentSync.open({ uri: URI, languageId: "typescript", version: 1, text: "call();\n" });
    return { stub, languages };
}

function item(name: string): vscode.CallHierarchyItem {
    const range = new Range(0, 0, 0, 4);
    return new CallHierarchyItem(
        SymbolKind.Function,
        name,
        "",
        Uri.parse(URI),
        range,
        range,
    ) as unknown as vscode.CallHierarchyItem;
}

function provider(overrides: Partial<vscode.CallHierarchyProvider> = {}): vscode.CallHierarchyProvider {
    return {
        prepareCallHierarchy: () => item("root"),
        provideCallHierarchyIncomingCalls: () => [],
        provideCallHierarchyOutgoingCalls: () => [],
        ...overrides,
    };
}

function prepareParams(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { handle: 0, uri: URI, languageId: "typescript", version: 1, line: 3, character: 4, ...overrides };
}

async function prepare(stub: IStubRpc, overrides: Record<string, unknown> = {}): Promise<ICallHierarchySession> {
    const session = await stub.callRequest("languages.prepareCallHierarchy", prepareParams(overrides));
    if (session === null) throw new Error("no session");
    return session as ICallHierarchySession;
}

const FROM_RANGE = new Range(1, 2, 1, 3) as unknown as vscode.Range;

afterEach(() => {
    vi.restoreAllMocks();
});

describe("LanguagesNamespace — registerCallHierarchyProvider", () => {
    it("registration is announced to the core as kind callHierarchy, dispose removes it", () => {
        const { stub, languages } = makeCtx();
        languages.registerCallHierarchyProvider("typescript", provider()).dispose();
        expect(stub.notifies.filter((n) => n.method.startsWith("languages."))).toEqual([
            {
                method: "languages.register",
                params: { handle: 0, kind: "callHierarchy", selector: [{ language: "typescript" }] },
            },
            { method: "languages.unregister", params: { handle: 0 } },
        ]);
    });
});

describe("LanguagesNamespace — languages.prepareCallHierarchy", () => {
    it("asks the provider of the handle with the document and the position", async () => {
        const { stub, languages } = makeCtx();
        const other = vi.fn(() => item("other"));
        const prepareRoot = vi.fn(() => item("root"));
        languages.registerCallHierarchyProvider("typescript", provider({ prepareCallHierarchy: other }));
        languages.registerCallHierarchyProvider("typescript", provider({ prepareCallHierarchy: prepareRoot }));

        const session = await prepare(stub, { handle: 1 });

        expect(session.items.map((i) => i.name)).toEqual(["root"]);
        expect(other).not.toHaveBeenCalled();
        const [document, position] = prepareRoot.mock.calls[0] as unknown as [vscode.TextDocument, vscode.Position];
        expect(document.uri.toString()).toBe(URI);
        expect([position.line, position.character]).toEqual([3, 4]);
    });

    it("an unknown or missing handle, an unsynced document, an empty answer: no session", async () => {
        const { stub, languages } = makeCtx();
        const first = vi.fn(() => item("first"));
        languages.registerCallHierarchyProvider("typescript", provider());
        languages.registerCallHierarchyProvider("typescript", provider({ prepareCallHierarchy: first }));
        const call = (overrides: Record<string, unknown>): Promise<unknown> =>
            stub.callRequest("languages.prepareCallHierarchy", prepareParams(overrides));

        expect(await call({ handle: 9 })).toBeNull();
        expect(await call({ handle: undefined })).toBeNull();
        expect(first).not.toHaveBeenCalled();
        expect(await call({ handle: 1, version: 7 })).toBeNull();
        expect(first).not.toHaveBeenCalled();
    });

    it("a failing provider answers nothing and reports to the log under its name", async () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { stub, languages } = makeCtx();
        languages.registerCallHierarchyProvider(
            "typescript",
            provider({
                prepareCallHierarchy: () => {
                    throw new Error("boom");
                },
            }),
        );
        expect(await stub.callRequest("languages.prepareCallHierarchy", prepareParams())).toBeNull();
        expect(errors).toHaveBeenCalledWith(expect.stringContaining("prepareCallHierarchy failed"));
    });

    it("a missing position counts as the start of the document", async () => {
        const { stub, languages } = makeCtx();
        const prepareRoot = vi.fn(() => item("root"));
        languages.registerCallHierarchyProvider("typescript", provider({ prepareCallHierarchy: prepareRoot }));
        await prepare(stub, { line: undefined, character: undefined });
        const position = (prepareRoot.mock.calls[0] as unknown as [unknown, vscode.Position])[1];
        expect([position.line, position.character]).toEqual([0, 0]);
    });
});

describe.each([
    {
        direction: "incoming",
        method: "languages.provideCallHierarchyIncomingCalls",
        providerMember: "provideCallHierarchyIncomingCalls",
        call: (target: vscode.CallHierarchyItem) =>
            new CallHierarchyIncomingCall(target as never, [FROM_RANGE as never]),
        name: (call: unknown) => (call as ICallHierarchyIncomingCall).from.name,
    },
    {
        direction: "outgoing",
        method: "languages.provideCallHierarchyOutgoingCalls",
        providerMember: "provideCallHierarchyOutgoingCalls",
        call: (target: vscode.CallHierarchyItem) =>
            new CallHierarchyOutgoingCall(target as never, [FROM_RANGE as never]),
        name: (call: unknown) => (call as ICallHierarchyOutgoingCall).to.name,
    },
] as const)("LanguagesNamespace — $method", ({ method, providerMember, call, name }) => {
    function setup(answer: () => unknown = () => [call(item("next"))]) {
        const { stub, languages } = makeCtx();
        const root = item("root");
        const ask = vi.fn(answer);
        // Handle 0 is a decoy: the request has to reach the provider of its own handle.
        languages.registerCallHierarchyProvider("typescript", provider());
        languages.registerCallHierarchyProvider(
            "typescript",
            provider({ prepareCallHierarchy: () => root, [providerMember]: ask }),
        );
        return { stub, root, ask };
    }

    it("the provider gets its own object, the answer goes through the session", async () => {
        const { stub, root, ask } = setup();
        const { sessionId, items } = await prepare(stub, { handle: 1 });

        const calls = (await stub.callRequest(method, { handle: 1, sessionId, itemId: items[0].itemId })) as unknown[];

        expect(ask.mock.calls[0]).toContain(root);
        expect(calls.map(name)).toEqual(["next"]);
        expect((calls[0] as { fromRanges: unknown }).fromRanges).toEqual([createRange(1, 2, 1, 3)]);
    });

    it("an unknown or missing handle answers nothing and asks nobody", async () => {
        const { stub, ask } = setup();
        const { sessionId, items } = await prepare(stub, { handle: 1 });
        const { itemId } = items[0];

        expect(await stub.callRequest(method, { handle: 9, sessionId, itemId })).toEqual([]);
        expect(await stub.callRequest(method, { sessionId, itemId })).toEqual([]);
        expect(ask).not.toHaveBeenCalled();
    });

    it("a missing session or item is `missing call hierarchy item` in the log, not a failure", async () => {
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { stub, ask } = setup();
        const { sessionId, items } = await prepare(stub, { handle: 1 });

        expect(await stub.callRequest(method, { handle: 1, itemId: items[0].itemId })).toEqual([]);
        expect(await stub.callRequest(method, { handle: 1, sessionId })).toEqual([]);
        expect(ask).not.toHaveBeenCalled();
        expect(errors).toHaveBeenCalledTimes(2);
        expect(errors).toHaveBeenCalledWith(
            expect.stringMatching(new RegExp(`${providerMember} failed.*missing call hierarchy item`, "s")),
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

        stub.fire("languages.releaseCallHierarchy", { handle: 1 });
        stub.fire("languages.releaseCallHierarchy", { sessionId });
        stub.fire("languages.releaseCallHierarchy", null);
        await stub.callRequest(method, params);
        expect(ask).toHaveBeenCalledTimes(1);

        stub.fire("languages.releaseCallHierarchy", { handle: 1, sessionId });
        expect(await stub.callRequest(method, params)).toEqual([]);
        expect(ask).toHaveBeenCalledTimes(1);
    });
});
