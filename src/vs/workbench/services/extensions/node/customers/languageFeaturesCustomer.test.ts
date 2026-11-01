import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import { CancellationTokenNone, CancellationTokenSource } from "../../../../../base/common/cancellation.ts";
import type { ITextDocument } from "../../../../../editor/common/model/iTextDocument.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import { DEFAULT_REQUEST_TIMEOUTS, type RequestTimeouts } from "../requestPolicy.ts";

import { LanguageFeaturesCustomer } from "./languageFeaturesCustomer.ts";

/** Each method has its own timeout: a mixed-up table key shows in the request options. */
const TIMEOUTS: RequestTimeouts = {
    ...DEFAULT_REQUEST_TIMEOUTS,
    "languages.resolveCompletionItem": 102,
    "languages.provideInlineCompletions": 103,
    "languages.provideFoldingRanges": 104,
    "languages.provideDefinition": 105,
    "languages.provideImplementation": 125,
    "languages.provideTypeDefinition": 125,
    "languages.provideDeclaration": 125,
    "languages.provideHover": 106,
    "languages.provideReferences": 107,
    "languages.provideSignatureHelp": 108,
    "languages.provideFormattingEdits": 109,
    "languages.provideCodeActions": 110,
    "languages.applyCodeAction": 111,
    "languages.prepareRename": 112,
    "languages.provideRenameEdits": 113,
};
const HOVER = { handle: 1, kind: "hover", selector: [{ language: "typescript" }] };
const COMPLETION = { handle: 2, kind: "completion", selector: [], triggerCharacters: ["."] };

function setup() {
    const customer = new LanguageFeaturesCustomer(TIMEOUTS, () => true, undefined);
    const changed = vi.fn();
    customer.onProvidersChanged(changed);
    const [a, b] = createInProcessChannelPair();
    const peer = new RpcEndpoint(b);
    const attached = customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
    return { customer, changed, peer, attached };
}

describe("LanguageFeaturesCustomer — spawn provider registry", () => {
    it("register and unregister change the set with an event; junk and a foreign handle — no event", async () => {
        const h = setup();
        h.peer.notify("languages.register", HOVER);
        h.peer.notify("languages.register", COMPLETION);
        h.peer.notify("languages.register", { handle: 3, kind: "nonsense", selector: [] });
        h.peer.notify("languages.register", null);
        await flushMicrotasks();
        expect(h.customer.getProviders()).toEqual([HOVER, COMPLETION]);
        expect(h.changed).toHaveBeenCalledTimes(2);

        h.peer.notify("languages.unregister", { handle: 1 });
        h.peer.notify("languages.unregister", { handle: 1 });
        h.peer.notify("languages.unregister", { handle: 99 });
        h.peer.notify("languages.unregister", null);
        await flushMicrotasks();
        expect(h.customer.getProviders()).toEqual([COMPLETION]);
        expect(h.changed).toHaveBeenCalledTimes(3);
    });

    it("spawn exit removes its providers with an event; an empty spawn exits silently", async () => {
        const h = setup();
        h.peer.notify("languages.register", HOVER);
        await flushMicrotasks();
        h.changed.mockClear();

        h.attached.dispose();
        expect(h.customer.getProviders()).toEqual([]);
        expect(h.changed).toHaveBeenCalledOnce();

        const empty = setup();
        empty.attached.dispose();
        expect(empty.changed).not.toHaveBeenCalled();
    });

    it("getProviders returns a snapshot, not the live collection", async () => {
        const h = setup();
        h.peer.notify("languages.register", HOVER);
        await flushMicrotasks();
        const snapshot = h.customer.getProviders();
        h.peer.notify("languages.register", COMPLETION);
        await flushMicrotasks();
        expect(snapshot).toEqual([HOVER]);
    });
});

function anyRequest(uri: string): never {
    return {
        uri,
        languageId: "typescript",
        versionId: 7,
        line: 2,
        character: 3,
        tabSize: 4,
        insertSpaces: true,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        triggerKind: 0,
    } as never;
}

interface IRequestCase {
    readonly name: string;
    readonly method: string;
    readonly call: (customer: LanguageFeaturesCustomer, uri: string) => Promise<unknown>;
    readonly empty: unknown;
}

const REQUEST_CASES: readonly IRequestCase[] = [
    {
        name: "completion",
        method: "languages.provideCompletionItems",
        call: (c, u) => c.provideCompletionItems(1, anyRequest(u)),
        empty: { items: [], isIncomplete: false },
    },
    {
        name: "inline completion",
        method: "languages.provideInlineCompletions",
        call: (c, u) => c.provideInlineCompletions(1, anyRequest(u)),
        empty: [],
    },
    {
        name: "folding",
        method: "languages.provideFoldingRanges",
        call: (c, u) => c.provideFoldingRanges(1, anyRequest(u)),
        empty: [],
    },
    {
        name: "definition",
        method: "languages.provideDefinition",
        call: (c, u) => c.provideDefinition(1, anyRequest(u)),
        empty: [],
    },
    {
        name: "implementation",
        method: "languages.provideImplementation",
        call: (c, u) => c.provideImplementation(1, anyRequest(u)),
        empty: [],
    },
    {
        name: "type definition",
        method: "languages.provideTypeDefinition",
        call: (c, u) => c.provideTypeDefinition(1, anyRequest(u)),
        empty: [],
    },
    {
        name: "declaration",
        method: "languages.provideDeclaration",
        call: (c, u) => c.provideDeclaration(1, anyRequest(u)),
        empty: [],
    },
    {
        name: "hover",
        method: "languages.provideHover",
        call: (c, u) => c.provideHover(1, anyRequest(u)),
        empty: undefined,
    },
    {
        name: "references",
        method: "languages.provideReferences",
        call: (c, u) => c.provideReferences(1, anyRequest(u)),
        empty: [],
    },
    {
        name: "signature help",
        method: "languages.provideSignatureHelp",
        call: (c, u) => c.provideSignatureHelp(1, anyRequest(u)),
        empty: null,
    },
    {
        name: "formatting",
        method: "languages.provideFormattingEdits",
        call: (c, u) => c.provideFormattingEdits(1, anyRequest(u)),
        empty: [],
    },
    {
        name: "code actions",
        method: "languages.provideCodeActions",
        call: (c, u) => c.provideCodeActions(1, anyRequest(u)),
        empty: [],
    },
    {
        name: "prepare rename",
        method: "languages.prepareRename",
        call: (c, u) => c.prepareRename(1, anyRequest(u)),
        empty: null,
    },
    {
        name: "rename",
        method: "languages.provideRenameEdits",
        call: (c, u) => c.provideRenameEdits(1, anyRequest(u), "renamed"),
        empty: { applied: false, error: "The document is not available to language extensions" },
    },
];

const EMPTY_WIRE: Readonly<Record<string, unknown>> = {
    "languages.provideCompletionItems": [],
    "languages.resolveCompletionItem": null,
    "languages.provideInlineCompletions": [],
    "languages.provideFoldingRanges": [],
    "languages.provideDefinition": [],
    "languages.provideImplementation": [],
    "languages.provideTypeDefinition": [],
    "languages.provideDeclaration": [],
    "languages.provideHover": null,
    "languages.provideReferences": [],
    "languages.provideSignatureHelp": null,
    "languages.provideFormattingEdits": [],
    "languages.provideCodeActions": [],
    "languages.applyCodeAction": false,
    "languages.prepareRename": null,
    "languages.provideRenameEdits": { applied: false },
};

const SYNCED = "file:///synced.ts";
const UNSYNCED = "file:///unsynced.ts";

function setupWithSync() {
    const asked: string[] = [];
    const customer = new LanguageFeaturesCustomer(
        TIMEOUTS,
        (uri) => {
            asked.push(uri);
            return uri === SYNCED;
        },
        undefined,
    );
    const [a, b] = createInProcessChannelPair();
    const peer = new RpcEndpoint(b);
    const hostRpc: HostRpc = new RpcEndpoint(a);
    const sent = vi.spyOn(hostRpc, "request");
    customer.attach({ rpc: hostRpc, logger: undefined });
    const requested: { method: string; params: Record<string, unknown> }[] = [];
    for (const method of [
        ...REQUEST_CASES.map((c) => c.method),
        "languages.resolveCompletionItem",
        "languages.applyCodeAction",
    ]) {
        peer.handleRequest(method, (params) => {
            requested.push({ method, params: params as Record<string, unknown> });
            return EMPTY_WIRE[method];
        });
    }
    return { customer, requested, asked, sent };
}

// No it.each: the mutation runner may not find parameterized names by the name filter.
describe("LanguageFeaturesCustomer — requests only for synced documents", () => {
    it("document not synced: empty reply of every kind without RPC", async () => {
        const h = setupWithSync();
        for (const c of REQUEST_CASES) {
            await expect(c.call(h.customer, UNSYNCED), c.name).resolves.toEqual(c.empty);
        }
        expect(h.requested).toEqual([]);
        expect(h.asked).toEqual(REQUEST_CASES.map(() => UNSYNCED));
    });

    it("synced document: the request carries version from versionId and no text", async () => {
        const h = setupWithSync();
        for (const c of REQUEST_CASES) await c.call(h.customer, SYNCED);
        expect(h.requested.map((r) => r.method)).toEqual(REQUEST_CASES.map((c) => c.method));
        for (const { method, params } of h.requested) {
            expect(params, method).toMatchObject({ uri: SYNCED, version: 7 });
            expect(params, method).not.toHaveProperty("text");
        }
    });

    it("document, position and provider addressing go over the wire in wire form", async () => {
        const h = setupWithSync();
        for (const c of REQUEST_CASES) await c.call(h.customer, SYNCED);
        const batched = new Set([
            "languages.provideCompletionItems",
            "languages.provideInlineCompletions",
            "languages.provideFoldingRanges",
        ]);
        const positionless = new Set([
            "languages.provideFoldingRanges",
            "languages.provideFormattingEdits",
            "languages.provideCodeActions",
        ]);
        for (const { method, params } of h.requested) {
            expect(params, method).toMatchObject({ uri: SYNCED, languageId: "typescript", version: 7 });
            expect(params, method).toMatchObject(batched.has(method) ? { handles: [1] } : { handle: 1 });
            if (positionless.has(method)) {
                expect(params, method).not.toHaveProperty("line");
            } else {
                expect(params, method).toMatchObject({ line: 2, character: 3 });
            }
        }
    });

    it("each request's reply timeout comes from the table by its method (resolve and apply have their own keys)", async () => {
        const h = setupWithSync();
        for (const c of REQUEST_CASES) await c.call(h.customer, SYNCED);
        await h.customer.resolveCompletionItem("item-1");
        await h.customer.applyCodeAction("action-1");
        const seen = h.sent.mock.calls.map(([method, , options]) => [method, options?.timeoutMs]);
        expect(seen).toEqual(
            [...REQUEST_CASES.map((c) => c.method), "languages.resolveCompletionItem", "languages.applyCodeAction"].map(
                (method) => [method, TIMEOUTS[method as keyof RequestTimeouts]],
            ),
        );
        expect(seen).toContainEqual(["languages.provideCompletionItems", undefined]);
        expect(seen.filter(([, timeoutMs]) => timeoutMs === undefined)).toHaveLength(1);
    });
});

const CORE_RANGE = { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } };

type Answer = (params: unknown) => unknown;

function setupAnswering(answers: Readonly<Record<string, Answer>>) {
    const customer = new LanguageFeaturesCustomer(TIMEOUTS, () => true, undefined);
    const [a, b] = createInProcessChannelPair();
    const peer = new RpcEndpoint(b);
    const hostRpc: HostRpc = new RpcEndpoint(a);
    const sent = vi.spyOn(hostRpc, "request");
    customer.attach({ rpc: hostRpc, logger: undefined });
    for (const [method, answer] of Object.entries(answers)) peer.handleRequest(method, answer);
    return { customer, sent };
}

function answerAll(answer: Answer): Record<string, Answer> {
    return Object.fromEntries(Object.keys(EMPTY_WIRE).map((method) => [method, answer]));
}

function emptyResult(c: IRequestCase, renameError: string): unknown {
    return c.method === "languages.provideRenameEdits" ? { applied: false, error: renameError } : c.empty;
}

describe("LanguageFeaturesCustomer — subprocess reply in core form", () => {
    it("batched replies are aligned by provider: a missing element is empty for its provider", async () => {
        const h = setupAnswering({
            "languages.provideCompletionItems": () => [
                { items: [{ label: "a", insertText: "a", range: CORE_RANGE }], isIncomplete: true },
            ],
            "languages.provideInlineCompletions": () => [[{ insertText: "x", range: CORE_RANGE }]],
            "languages.provideFoldingRanges": () => [
                [
                    { start: 1, end: 4, kind: 3 },
                    { start: 6, end: 6 },
                ],
            ],
        });
        const c = h.customer;
        // Only the same request object forms a batch.
        const req = anyRequest(SYNCED);
        expect(await Promise.all([c.provideCompletionItems(1, req), c.provideCompletionItems(2, req)])).toEqual([
            { items: [{ label: "a", insertText: "a", range: CORE_RANGE }], isIncomplete: true },
            { items: [], isIncomplete: false },
        ]);
        expect(await Promise.all([c.provideInlineCompletions(1, req), c.provideInlineCompletions(2, req)])).toEqual([
            [{ insertText: "x", range: CORE_RANGE }],
            [],
        ]);
        // A degenerate range is filtered out by the conversion to core regions.
        expect(await Promise.all([c.provideFoldingRanges(1, req), c.provideFoldingRanges(2, req)])).toEqual([
            [{ startLine: 1, endLine: 4, isCollapsed: false }],
            [],
        ]);
    });

    it("single replies are converted to core form", async () => {
        const h = setupAnswering({
            "languages.resolveCompletionItem": () => ({
                detail: "d",
                additionalEdits: [{ range: CORE_RANGE, text: "import x\n" }],
            }),
            "languages.provideDefinition": () => [{ uri: "file:///b.ts", range: CORE_RANGE }],
            "languages.provideImplementation": () => [{ uri: "file:///i.ts", range: CORE_RANGE }],
            "languages.provideTypeDefinition": () => [{ uri: "file:///t.ts", range: CORE_RANGE }],
            "languages.provideDeclaration": () => [{ uri: "file:///e.ts", range: CORE_RANGE }],
            "languages.provideHover": () => ({ contents: ["**x**"], range: CORE_RANGE }),
            "languages.provideReferences": () => [{ uri: "file:///c.ts", range: CORE_RANGE }],
            "languages.provideSignatureHelp": () => ({
                signatures: [{ label: "f(a)", parameters: [] }],
                activeSignature: 0,
                activeParameter: -1,
            }),
            "languages.provideFormattingEdits": () => [{ range: CORE_RANGE, text: "  " }],
            "languages.provideCodeActions": () => [{ id: "1.0", title: "Fix", kind: "quickfix", isPreferred: true }],
            "languages.applyCodeAction": () => true,
            "languages.prepareRename": () => ({ placeholder: "value" }),
            "languages.provideRenameEdits": () => ({ applied: false, error: "Invalid name" }),
        });
        const c = h.customer;
        expect(await c.resolveCompletionItem("1.0")).toEqual({
            detail: "d",
            additionalEdits: [{ range: CORE_RANGE, text: "import x\n" }],
        });
        expect(await c.provideDefinition(1, anyRequest(SYNCED))).toEqual([{ uri: "file:///b.ts", range: CORE_RANGE }]);
        expect(await c.provideImplementation(1, anyRequest(SYNCED))).toEqual([
            { uri: "file:///i.ts", range: CORE_RANGE },
        ]);
        expect(await c.provideTypeDefinition(1, anyRequest(SYNCED))).toEqual([
            { uri: "file:///t.ts", range: CORE_RANGE },
        ]);
        expect(await c.provideDeclaration(1, anyRequest(SYNCED))).toEqual([{ uri: "file:///e.ts", range: CORE_RANGE }]);
        expect(await c.provideHover(1, anyRequest(SYNCED))).toEqual({ contents: ["**x**"], range: CORE_RANGE });
        expect(await c.provideReferences(1, anyRequest(SYNCED))).toEqual([{ uri: "file:///c.ts", range: CORE_RANGE }]);
        expect(await c.provideSignatureHelp(1, anyRequest(SYNCED))).toEqual({
            signatures: [{ label: "f(a)", parameters: [] }],
            activeSignature: 0,
            activeParameter: -1,
        });
        expect(await c.provideFormattingEdits(1, anyRequest(SYNCED))).toEqual([{ range: CORE_RANGE, text: "  " }]);
        expect(await c.provideCodeActions(1, anyRequest(SYNCED))).toEqual([
            { id: "1.0", title: "Fix", kind: "quickfix", isPreferred: true },
        ]);
        expect(await c.applyCodeAction("1.0")).toBe(true);
        expect(await c.prepareRename(1, anyRequest(SYNCED))).toEqual({ kind: "name", name: "value" });
        expect(await c.provideRenameEdits(1, anyRequest(SYNCED), "renamed")).toEqual({
            applied: false,
            error: "Invalid name",
        });
    });

    it("subprocess `nothing to say` is empty in core form", async () => {
        const empty = setupAnswering(
            Object.fromEntries(Object.entries(EMPTY_WIRE).map(([method, value]) => [method, () => value])),
        );
        for (const c of REQUEST_CASES) {
            const expected = c.method === "languages.provideRenameEdits" ? { applied: false } : c.empty;
            await expect(c.call(empty.customer, SYNCED), c.name).resolves.toEqual(expected);
        }
        expect(await empty.customer.resolveCompletionItem("1.0")).toBeNull();
        expect(await empty.customer.applyCodeAction("1.0")).toBe(false);
    });
});

describe("LanguageFeaturesCustomer — request failure", () => {
    it("RPC rejection — empty reply of every kind; rename — rejection WITH a message", async () => {
        const h = setupAnswering(
            answerAll(() => {
                throw new Error("boom");
            }),
        );
        for (const c of REQUEST_CASES) {
            await expect(c.call(h.customer, SYNCED), c.name).resolves.toEqual(emptyResult(c, "Rename timed out"));
        }
        expect(await h.customer.resolveCompletionItem("1.0")).toBeNull();
        expect(await h.customer.applyCodeAction("1.0")).toBe(false);
    });

    it("expired timeout — empty reply, the user learns the rename did not happen", async () => {
        const h = setupAnswering(answerAll(() => new Promise<never>(() => undefined)));
        await expect(h.customer.provideHover(1, anyRequest(SYNCED))).resolves.toBeUndefined();
        await expect(h.customer.provideRenameEdits(1, anyRequest(SYNCED), "renamed")).resolves.toEqual({
            applied: false,
            error: "Rename timed out",
        });
    });

    it("no spawn — empty reply of every kind without asking about sync", async () => {
        const asked: string[] = [];
        const customer = new LanguageFeaturesCustomer(
            TIMEOUTS,
            (uri) => {
                asked.push(uri);
                return true;
            },
            undefined,
        );
        for (const c of REQUEST_CASES) {
            await expect(c.call(customer, SYNCED), c.name).resolves.toEqual(emptyResult(c, "Rename failed"));
        }
        expect(await customer.resolveCompletionItem("1.0")).toBeNull();
        expect(await customer.applyCodeAction("1.0")).toBe(false);
        expect(asked).toEqual([]);
    });
});

describe("LanguageFeaturesCustomer — inline completions request options", () => {
    it("the request's own timeout and the core token go into options; without one — the table timeout", async () => {
        const h = setupAnswering({ "languages.provideInlineCompletions": () => [[]] });
        const caller = new CancellationTokenSource();
        await h.customer.provideInlineCompletions(
            1,
            { ...(anyRequest(SYNCED) as object), timeoutMs: 7 } as never,
            caller.token,
        );
        await h.customer.provideInlineCompletions(1, anyRequest(SYNCED));
        expect(h.sent.mock.calls.map(([, , options]) => options)).toStrictEqual([
            { timeoutMs: 7, token: caller.token },
            { timeoutMs: TIMEOUTS["languages.provideInlineCompletions"], token: CancellationTokenNone },
        ]);
        await h.customer.provideHover(1, anyRequest(SYNCED));
        expect(h.sent.mock.calls.at(-1)?.[2]).toStrictEqual({ timeoutMs: TIMEOUTS["languages.provideHover"] });
    });
});

describe("LanguageFeaturesCustomer — semantic tokens", () => {
    const REQ = { uri: SYNCED, languageId: "typescript", versionId: 7 };
    const RANGE_REQ = { ...REQ, range: CORE_RANGE };

    it("document: wire params, no timeout; reply in core form with resultId as a string", async () => {
        const seen: unknown[] = [];
        const h = setupAnswering({
            "languages.provideDocumentSemanticTokens": (params) => {
                seen.push(params);
                return seen.length === 1
                    ? { id: 3, type: "full", data: [0, 1, 2, 3, 4] }
                    : { id: 4, type: "delta", deltas: [{ start: 1, deleteCount: 2 }] };
            },
        });
        const token = new CancellationTokenSource().token;
        expect(await h.customer.provideDocumentSemanticTokens(5, REQ, 2, token)).toStrictEqual({
            resultId: "3",
            data: new Uint32Array([0, 1, 2, 3, 4]),
        });
        expect(await h.customer.provideDocumentSemanticTokens(5, REQ, 3)).toStrictEqual({
            resultId: "4",
            edits: [{ start: 1, deleteCount: 2, data: undefined }],
        });
        expect(seen[0]).toStrictEqual({
            handle: 5,
            uri: SYNCED,
            languageId: "typescript",
            version: 7,
            previousResultId: 2,
        });
        expect(h.sent.mock.calls[0][2]).toStrictEqual({ timeoutMs: undefined, token });
    });

    it("range: the range goes over the wire; a delta in the reply throws Unexpected", async () => {
        const seen: unknown[] = [];
        const answers: unknown[] = [
            { id: 0, type: "full", data: [1, 2, 3, 4, 5] },
            null,
            { id: 0, type: "delta", deltas: [] },
        ];
        const h = setupAnswering({
            "languages.provideDocumentRangeSemanticTokens": (params) => {
                seen.push(params);
                return answers.shift();
            },
        });
        expect(await h.customer.provideDocumentRangeSemanticTokens(6, RANGE_REQ)).toStrictEqual({
            resultId: "0",
            data: new Uint32Array([1, 2, 3, 4, 5]),
        });
        expect(seen[0]).toStrictEqual({
            handle: 6,
            uri: SYNCED,
            languageId: "typescript",
            version: 7,
            range: CORE_RANGE,
        });
        expect(await h.customer.provideDocumentRangeSemanticTokens(6, RANGE_REQ)).toBeNull();
        await expect(h.customer.provideDocumentRangeSemanticTokens(6, RANGE_REQ)).rejects.toThrow("Unexpected");
    });

    it("RPC rejection throws (not null): the consumer keeps its previous tokens", async () => {
        const h = setupAnswering({
            "languages.provideDocumentSemanticTokens": () => Promise.reject(new Error("busy")),
            "languages.provideDocumentRangeSemanticTokens": () => Promise.reject(new Error("down")),
        });
        await expect(h.customer.provideDocumentSemanticTokens(1, REQ, 0)).rejects.toThrow("busy");
        await expect(h.customer.provideDocumentRangeSemanticTokens(1, RANGE_REQ)).rejects.toThrow("down");
    });

    it("no spawn or document not synced — null without RPC", async () => {
        const noHost = new LanguageFeaturesCustomer(TIMEOUTS, () => true, undefined);
        expect(await noHost.provideDocumentSemanticTokens(1, REQ, 0)).toBeNull();
        expect(await noHost.provideDocumentRangeSemanticTokens(1, RANGE_REQ)).toBeNull();
        noHost.releaseDocumentSemanticTokens(1, 2);

        const h = setupWithSync();
        const unsynced = { ...REQ, uri: UNSYNCED };
        expect(await h.customer.provideDocumentSemanticTokens(1, unsynced, 0)).toBeNull();
        expect(await h.customer.provideDocumentRangeSemanticTokens(1, { ...unsynced, range: CORE_RANGE })).toBeNull();
        expect(h.sent).not.toHaveBeenCalled();
    });

    it("releaseDocumentSemanticTokens goes as a notification with handle and id", async () => {
        const customer = new LanguageFeaturesCustomer(TIMEOUTS, () => true, undefined);
        const [a, b] = createInProcessChannelPair();
        const peer = new RpcEndpoint(b);
        const released: unknown[] = [];
        peer.handleNotification("languages.releaseDocumentSemanticTokens", (params) => released.push(params));
        customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
        customer.releaseDocumentSemanticTokens(3, 9);
        await flushMicrotasks();
        expect(released).toStrictEqual([{ handle: 3, resultId: 9 }]);
    });

    it("onDidChangeSemanticTokens — only for a declared handle", async () => {
        const h = setup();
        const changed = vi.fn();
        h.customer.onDidChangeSemanticTokens(changed);
        h.peer.notify("languages.register", { handle: 4, kind: "semanticTokens", selector: [] });
        await flushMicrotasks();
        h.peer.notify("languages.didChangeSemanticTokens", { handle: 4 });
        h.peer.notify("languages.didChangeSemanticTokens", { handle: 8 });
        h.peer.notify("languages.didChangeSemanticTokens", null);
        h.peer.notify("languages.didChangeSemanticTokens", { handle: "4" });
        await flushMicrotasks();
        expect(changed.mock.calls).toStrictEqual([[4]]);
    });
});

describe("LanguageFeaturesCustomer — selection ranges", () => {
    const REQ = { uri: SYNCED, languageId: "typescript", versionId: 7, positions: [{ line: 2, character: 4 }] };

    it("cursor positions and the token go over the wire, the reply is returned as is", async () => {
        const seen: unknown[] = [];
        const h = setupAnswering({
            "languages.provideSelectionRanges": (params) => {
                seen.push(params);
                return [[CORE_RANGE]];
            },
        });
        const caller = new CancellationTokenSource();
        expect(await h.customer.provideSelectionRanges(1, REQ, caller.token)).toEqual([[CORE_RANGE]]);
        expect(seen).toEqual([
            { handle: 1, uri: SYNCED, languageId: "typescript", version: 7, positions: REQ.positions },
        ]);
        expect(h.sent.mock.calls.at(-1)?.[2]).toMatchObject({ token: caller.token });
    });

    it("RPC rejection or no spawn — no selection ranges", async () => {
        const h = setupAnswering({
            "languages.provideSelectionRanges": () => {
                throw new Error("boom");
            },
        });
        expect(await h.customer.provideSelectionRanges(1, REQ)).toEqual([]);
        const detached = new LanguageFeaturesCustomer(TIMEOUTS, () => true, undefined);
        expect(await detached.provideSelectionRanges(1, REQ)).toEqual([]);
    });
});

describe("LanguageFeaturesCustomer — inlay hints", () => {
    const REQ = { uri: SYNCED, languageId: "typescript", versionId: 7, range: CORE_RANGE };
    const AT = { line: 0, character: 1 };

    it("the document, the range and the token go over the wire; the reply becomes core hints without the broken ones", async () => {
        const seen: unknown[] = [];
        const h = setupAnswering({
            "languages.provideInlayHints": (params) => {
                seen.push(params);
                return [
                    { position: AT, label: [{ value: "name" }], kind: 2 },
                    { position: AT, label: "broken", kind: 9 as 1 },
                ];
            },
        });
        const caller = new CancellationTokenSource();
        expect(await h.customer.provideInlayHints(1, REQ, caller.token)).toEqual([
            { position: AT, label: [{ label: "name" }], kind: 2 },
        ]);
        expect(seen).toEqual([{ handle: 1, uri: SYNCED, languageId: "typescript", version: 7, range: CORE_RANGE }]);
        expect(h.sent.mock.calls.at(-1)?.[2]).toMatchObject({ token: caller.token, timeoutMs: 5000 });
    });

    it("RPC rejection, a hung request past its timeout, no spawn or an unsynced document — no hints (null)", async () => {
        const h = setupAnswering({
            "languages.provideInlayHints": () => {
                throw new Error("boom");
            },
        });
        expect(await h.customer.provideInlayHints(1, REQ)).toBeNull();

        vi.useFakeTimers();
        try {
            const hung = setupAnswering({ "languages.provideInlayHints": () => new Promise(() => undefined) });
            const reply = hung.customer.provideInlayHints(1, REQ);
            await vi.advanceTimersByTimeAsync(5000);
            expect(await reply).toBeNull();
        } finally {
            vi.useRealTimers();
        }

        const detached = new LanguageFeaturesCustomer(TIMEOUTS, () => true, undefined);
        expect(await detached.provideInlayHints(1, REQ)).toBeNull();
        const unsynced = new LanguageFeaturesCustomer(TIMEOUTS, () => false, undefined);
        const [a] = createInProcessChannelPair();
        unsynced.attach({ rpc: new RpcEndpoint(a), logger: undefined });
        expect(await unsynced.provideInlayHints(1, REQ)).toBeNull();
    });

    it("onDidChangeInlayHints — only for a declared handle", async () => {
        const h = setup();
        const changed = vi.fn();
        h.customer.onDidChangeInlayHints(changed);
        h.peer.notify("languages.register", { handle: 4, kind: "inlayHints", selector: [] });
        await flushMicrotasks();
        h.peer.notify("languages.didChangeInlayHints", { handle: 4 });
        h.peer.notify("languages.didChangeInlayHints", { handle: 8 });
        h.peer.notify("languages.didChangeInlayHints", null);
        await flushMicrotasks();
        expect(changed.mock.calls).toStrictEqual([[4]]);
    });
});

describe("LanguageFeaturesCustomer — code lens", () => {
    const REQ = { uri: SYNCED, languageId: "typescript", versionId: 7 };
    const LENS = { cacheId: [3, 0] as const, range: CORE_RANGE, command: { id: "run", title: "Run" } };

    it("provide: the document and the token go over the wire, a broken lens costs itself", async () => {
        const seen: unknown[] = [];
        const h = setupAnswering({
            "languages.provideCodeLenses": (params) => {
                seen.push(params);
                return { cacheId: 3, lenses: [LENS, { range: CORE_RANGE }] };
            },
        });
        const caller = new CancellationTokenSource();
        expect(await h.customer.provideCodeLenses(1, REQ, caller.token)).toEqual({ cacheId: 3, lenses: [LENS] });
        expect(seen).toEqual([{ handle: 1, uri: SYNCED, languageId: "typescript", version: 7 }]);
        expect(h.sent.mock.calls.at(-1)?.[2]).toMatchObject({ token: caller.token, timeoutMs: 5000 });
    });

    it("provide: RPC rejection, a hung request past its timeout, no spawn or an unsynced document — null", async () => {
        const h = setupAnswering({
            "languages.provideCodeLenses": () => {
                throw new Error("boom");
            },
        });
        expect(await h.customer.provideCodeLenses(1, REQ)).toBeNull();

        vi.useFakeTimers();
        try {
            const hung = setupAnswering({ "languages.provideCodeLenses": () => new Promise(() => undefined) });
            const reply = hung.customer.provideCodeLenses(1, REQ);
            await vi.advanceTimersByTimeAsync(5000);
            expect(await reply).toBeNull();
        } finally {
            vi.useRealTimers();
        }

        const detached = new LanguageFeaturesCustomer(TIMEOUTS, () => true, undefined);
        expect(await detached.provideCodeLenses(1, REQ)).toBeNull();
        const unsynced = new LanguageFeaturesCustomer(TIMEOUTS, () => false, undefined);
        const [a] = createInProcessChannelPair();
        unsynced.attach({ rpc: new RpcEndpoint(a), logger: undefined });
        expect(await unsynced.provideCodeLenses(1, REQ)).toBeNull();
    });

    it("resolve: the address and the token go over the wire; no answer and a failure are null", async () => {
        const seen: unknown[] = [];
        const h = setupAnswering({
            "languages.resolveCodeLens": (params) => {
                seen.push(params);
                return LENS;
            },
        });
        const caller = new CancellationTokenSource();
        expect(await h.customer.resolveCodeLens(1, [3, 0], caller.token)).toEqual(LENS);
        expect(seen).toEqual([{ handle: 1, cacheId: [3, 0] }]);
        expect(h.sent.mock.calls.at(-1)?.[2]).toMatchObject({ token: caller.token, timeoutMs: 5000 });

        const empty = setupAnswering({ "languages.resolveCodeLens": () => null });
        expect(await empty.customer.resolveCodeLens(1, [3, 0])).toBeNull();
        const failing = setupAnswering({
            "languages.resolveCodeLens": () => {
                throw new Error("boom");
            },
        });
        expect(await failing.customer.resolveCodeLens(1, [3, 0])).toBeNull();
    });

    it("release: a notification with the session; no spawn — nothing", async () => {
        const h = setup();
        const released = vi.fn();
        h.peer.handleNotification("languages.releaseCodeLenses", released);
        h.customer.releaseCodeLenses(2, 3);
        await flushMicrotasks();
        expect(released).toHaveBeenCalledWith({ handle: 2, cacheId: 3 });

        const detached = new LanguageFeaturesCustomer(TIMEOUTS, () => true, undefined);
        expect(() => {
            detached.releaseCodeLenses(2, 3);
        }).not.toThrow();
    });

    it("execute: the address goes over the wire without a timeout, the failure of the command rejects", async () => {
        const seen: unknown[] = [];
        const h = setupAnswering({
            "languages.executeCodeLensCommand": (params) => {
                seen.push(params);
            },
        });
        await h.customer.executeCodeLensCommand(1, [3, 0]);
        expect(seen).toEqual([{ handle: 1, cacheId: [3, 0] }]);
        expect(h.sent.mock.calls.at(-1)?.[2]).toMatchObject({ timeoutMs: undefined });

        const failing = setupAnswering({
            "languages.executeCodeLensCommand": () => {
                throw new Error("command exploded");
            },
        });
        await expect(failing.customer.executeCodeLensCommand(1, [3, 0])).rejects.toThrow("command exploded");

        const detached = new LanguageFeaturesCustomer(TIMEOUTS, () => true, undefined);
        await expect(detached.executeCodeLensCommand(1, [3, 0])).resolves.toBeUndefined();
    });

    it("onDidChangeCodeLenses — only for a declared handle", async () => {
        const h = setup();
        const changed = vi.fn();
        h.customer.onDidChangeCodeLenses(changed);
        h.peer.notify("languages.register", { handle: 4, kind: "codeLens", selector: [] });
        await flushMicrotasks();
        h.peer.notify("languages.didChangeCodeLenses", { handle: 4 });
        h.peer.notify("languages.didChangeCodeLenses", { handle: 8 });
        h.peer.notify("languages.didChangeCodeLenses", null);
        await flushMicrotasks();
        expect(changed.mock.calls).toStrictEqual([[4]]);
    });
});

describe("LanguageFeaturesCustomer — document colors", () => {
    const REQ = { uri: SYNCED, languageId: "css", versionId: 7, document: {} as ITextDocument };
    const RED = { range: CORE_RANGE, color: { red: 1, green: 0, blue: 0, alpha: 1 } };

    it("the document and the token go over the wire, the reply is returned as is", async () => {
        const seen: unknown[] = [];
        const h = setupAnswering({
            "languages.provideDocumentColors": (params) => {
                seen.push(params);
                return [RED];
            },
        });
        const caller = new CancellationTokenSource();
        expect(await h.customer.provideDocumentColors(1, REQ, caller.token)).toEqual([RED]);
        expect(seen).toEqual([{ handle: 1, uri: SYNCED, languageId: "css", version: 7 }]);
        expect(h.sent.mock.calls.at(-1)?.[2]).toMatchObject({ token: caller.token, timeoutMs: 5000 });
    });

    it("RPC rejection, a hung request past its timeout, no spawn or an unsynced document — no colors (null)", async () => {
        const h = setupAnswering({
            "languages.provideDocumentColors": () => {
                throw new Error("boom");
            },
        });
        expect(await h.customer.provideDocumentColors(1, REQ)).toBeNull();

        // A hung extension holds the detector at most for the timeout.
        vi.useFakeTimers();
        try {
            const hung = setupAnswering({ "languages.provideDocumentColors": () => new Promise(() => undefined) });
            const reply = hung.customer.provideDocumentColors(1, REQ);
            await vi.advanceTimersByTimeAsync(5000);
            expect(await reply).toBeNull();
        } finally {
            vi.useRealTimers();
        }

        const detached = new LanguageFeaturesCustomer(TIMEOUTS, () => true, undefined);
        expect(await detached.provideDocumentColors(1, REQ)).toBeNull();
        const unsynced = new LanguageFeaturesCustomer(TIMEOUTS, () => false, undefined);
        const [a] = createInProcessChannelPair();
        unsynced.attach({ rpc: new RpcEndpoint(a), logger: undefined });
        expect(await unsynced.provideDocumentColors(1, REQ)).toBeNull();
    });
});
