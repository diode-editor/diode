import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { CancellationTokenSource } from "../../../base/common/cancellation.ts";
import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import type { SubprocessRpc } from "./extHostProtocol.ts";
import { createInProcessChannelPair } from "./inProcessChannelPair.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { RpcEndpoint, TimeoutError } from "./rpcEndpoint.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { CancellationError, CodeAction } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

/**
 * Отмена и сбои провайдеров языковых фич на стороне субпроцесса: каждый
 * провайдер получает настоящий токен (срок ответа хоста его отменяет), а сбой
 * провайдера пишется в stderr — кроме честной отмены.
 */

const URI = "file:///proj/main.ts";
const DOC = { uri: URI, languageId: "typescript", version: 1 };
const POS = { ...DOC, handle: 0, line: 0, character: 1 };
const SELECTOR = { language: "typescript" };

function makeCtx(rpc: SubprocessRpc): IVscodeHostContext {
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry, () => undefined),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    ctx.documentSync.open({ ...DOC, text: "a.b\n" });
    return ctx;
}

type Languages = typeof vscode.languages;
type ProviderCall = (token: vscode.CancellationToken) => unknown;

/**
 * Случай: как зарегистрировать провайдера, чей вызов делегирован `call`, и
 * какой запрос хоста до него доходит. `prepare` — запросы, без которых целевой
 * не к чему применить (resolve ищет пункт в кэше предыдущего ответа).
 */
interface ICase {
    readonly name: string;
    readonly method: string;
    readonly register: (languages: Languages, call: ProviderCall) => void;
    readonly params: (prepared: unknown) => unknown;
    readonly prepare?: (request: (method: string, params: unknown) => Promise<unknown>) => Promise<unknown>;
    /** Имя в строке stderr при сбое провайдера. */
    readonly failure: string;
    /** Отказ провайдера уходит хосту исключением, а не пустым ответом (семантические токены). */
    readonly rethrows?: boolean;
}

/** Дожидается запроса; у случаев с `rethrows` он обязан кончиться отказом. */
async function settle(c: ICase, request: Promise<unknown>): Promise<void> {
    if (c.rethrows === true) await expect(request, c.name).rejects.toBeInstanceOf(Error);
    else await request;
}

const CASES: readonly ICase[] = [
    {
        name: "definition",
        method: "languages.provideDefinition",
        register: (l, call) =>
            l.registerDefinitionProvider(SELECTOR, { provideDefinition: (_d, _p, t) => call(t) as never }),
        params: () => POS,
        failure: "provideDefinition",
    },
    {
        name: "hover",
        method: "languages.provideHover",
        register: (l, call) => l.registerHoverProvider(SELECTOR, { provideHover: (_d, _p, t) => call(t) as never }),
        params: () => POS,
        failure: "provideHover",
    },
    {
        name: "signature help",
        method: "languages.provideSignatureHelp",
        register: (l, call) =>
            l.registerSignatureHelpProvider(SELECTOR, { provideSignatureHelp: (_d, _p, t) => call(t) as never }),
        params: () => POS,
        failure: "provideSignatureHelp",
    },
    {
        name: "references",
        method: "languages.provideReferences",
        register: (l, call) =>
            l.registerReferenceProvider(SELECTOR, { provideReferences: (_d, _p, _c, t) => call(t) as never }),
        params: () => POS,
        failure: "provideReferences",
    },
    {
        name: "document formatting",
        method: "languages.provideFormattingEdits",
        register: (l, call) =>
            l.registerDocumentFormattingEditProvider(SELECTOR, {
                provideDocumentFormattingEdits: (_d, _o, t) => call(t) as never,
            }),
        params: () => ({ ...DOC, handle: 0 }),
        failure: "provideDocumentFormattingEdits",
    },
    {
        name: "range formatting",
        method: "languages.provideFormattingEdits",
        register: (l, call) =>
            l.registerDocumentRangeFormattingEditProvider(SELECTOR, {
                provideDocumentRangeFormattingEdits: (_d, _r, _o, t) => call(t) as never,
            }),
        params: () => ({
            ...DOC,
            handle: 0,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        }),
        failure: "provideDocumentRangeFormattingEdits",
    },
    {
        name: "code actions",
        method: "languages.provideCodeActions",
        register: (l, call) =>
            l.registerCodeActionsProvider(SELECTOR, { provideCodeActions: (_d, _r, _c, t) => call(t) as never }),
        params: () => ({
            ...DOC,
            handle: 0,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        }),
        failure: "provideCodeActions",
    },
    {
        name: "resolve code action",
        method: "languages.applyCodeAction",
        register: (l, call) =>
            l.registerCodeActionsProvider(SELECTOR, {
                provideCodeActions: () => [new CodeAction("fix") as never],
                resolveCodeAction: (_a, t) => call(t) as never,
            }),
        prepare: (request) =>
            request("languages.provideCodeActions", {
                ...DOC,
                handle: 0,
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            }),
        params: (prepared) => ({ id: (prepared as { id: string }[])[0]?.id }),
        failure: "resolveCodeAction",
    },
    {
        name: "completion",
        method: "languages.provideCompletionItems",
        register: (l, call) =>
            l.registerCompletionItemProvider(SELECTOR, { provideCompletionItems: (_d, _p, t) => call(t) as never }),
        params: () => ({ ...POS, handles: [0] }),
        failure: "provideCompletionItems",
    },
    {
        name: "resolve completion",
        method: "languages.resolveCompletionItem",
        register: (l, call) =>
            l.registerCompletionItemProvider(SELECTOR, {
                provideCompletionItems: () => [{ label: "a" }],
                resolveCompletionItem: (_i, t) => call(t) as never,
            }),
        prepare: (request) => request("languages.provideCompletionItems", { ...POS, handles: [0] }),
        params: (prepared) => ({ id: (prepared as { items: { id: string }[] }[])[0]?.items[0]?.id }),
        failure: "resolveCompletionItem",
    },
    {
        name: "folding",
        method: "languages.provideFoldingRanges",
        register: (l, call) =>
            l.registerFoldingRangeProvider(SELECTOR, { provideFoldingRanges: (_d, _c, t) => call(t) as never }),
        params: () => ({ ...DOC, handles: [0] }),
        failure: "provideFoldingRanges",
    },
    {
        name: "inline completions",
        method: "languages.provideInlineCompletions",
        register: (l, call) =>
            l.registerInlineCompletionItemProvider(SELECTOR, {
                provideInlineCompletionItems: (_d, _p, _c, t) => call(t) as never,
            }),
        params: () => ({ ...POS, handles: [0] }),
        failure: "provideInlineCompletionItems",
    },
    {
        name: "prepare rename",
        method: "languages.prepareRename",
        register: (l, call) =>
            l.registerRenameProvider(SELECTOR, {
                provideRenameEdits: () => undefined,
                prepareRename: (_d, _p, t) => call(t) as never,
            }),
        params: () => POS,
        // Отказ prepareRename — ответ «здесь нельзя», а не сбой: в stderr не пишется.
        failure: "",
    },
    {
        name: "rename edits",
        method: "languages.provideRenameEdits",
        register: (l, call) =>
            l.registerRenameProvider(SELECTOR, { provideRenameEdits: (_d, _p, _n, t) => call(t) as never }),
        params: () => ({ ...POS, newName: "c" }),
        failure: "",
    },
    {
        name: "document semantic tokens",
        method: "languages.provideDocumentSemanticTokens",
        register: (l, call) =>
            l.registerDocumentSemanticTokensProvider(
                SELECTOR,
                { provideDocumentSemanticTokens: (_d, t) => call(t) as never },
                { tokenTypes: ["class"], tokenModifiers: [] },
            ),
        params: () => ({ ...DOC, handle: 0, previousResultId: 0 }),
        failure: "provideDocumentSemanticTokens",
        rethrows: true,
    },
    {
        name: "range semantic tokens",
        method: "languages.provideDocumentRangeSemanticTokens",
        register: (l, call) =>
            l.registerDocumentRangeSemanticTokensProvider(
                SELECTOR,
                { provideDocumentRangeSemanticTokens: (_d, _r, t) => call(t) as never },
                { tokenTypes: ["class"], tokenModifiers: [] },
            ),
        params: () => ({
            ...DOC,
            handle: 0,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
        }),
        failure: "provideDocumentRangeSemanticTokens",
        rethrows: true,
    },
];

describe("LanguagesNamespace — срок ответа хоста отменяет токен провайдера", () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("у каждого провайдера: до срока токен жив, по сроку — отменён и слушатель сработал", async () => {
        for (const c of CASES) {
            const [hostSide, subSide] = createInProcessChannelPair();
            const host = new RpcEndpoint(hostSide);
            const { languages } = createLanguagesNamespace(makeCtx(new RpcEndpoint(subSide)));
            let seen: vscode.CancellationToken | undefined;
            const fired: string[] = [];
            c.register(languages, (token) => {
                seen = token;
                token.onCancellationRequested(() => fired.push("cancelled"));
                // Провайдер честно ждёт отмены и отвечает пустым.
                return new Promise((resolve) => {
                    token.onCancellationRequested(() => {
                        resolve(undefined);
                    });
                });
            });
            const prepared = await c.prepare?.((m, p) => host.request(m, p));

            const pending = host.request(c.method, c.params(prepared), { timeoutMs: 50 });
            const outcome = pending.catch((e: unknown) => e);
            await vi.advanceTimersByTimeAsync(49);
            expect(seen?.isCancellationRequested, c.name).toBe(false);
            expect(fired, c.name).toEqual([]);

            await vi.advanceTimersByTimeAsync(1);
            expect(seen?.isCancellationRequested, c.name).toBe(true);
            expect(fired, c.name).toEqual(["cancelled"]);
            expect(await outcome, c.name).toBeInstanceOf(TimeoutError);
        }
    });
});

function makeStubCtx(): { stub: IStubRpc; languages: Languages; owner: ExtensionOwner } {
    const stub = makeStubRpc();
    const ctx = makeCtx(stub.rpc);
    const { languages } = createLanguagesNamespace(ctx);
    return { stub, languages, owner: ctx.owner };
}

describe("LanguagesNamespace — сбой провайдера в stderr", () => {
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

    it("исключение провайдера — строка с методом и стеком; ответ — как у пустого провайдера (или отказ)", async () => {
        for (const c of CASES) {
            errors = [];
            const { stub, languages } = makeStubCtx();
            const failure = new Error(`boom in ${c.name}`);
            c.register(languages, () => {
                throw failure;
            });
            const prepared = await c.prepare?.((m, p) => stub.callRequest(m, p));
            await settle(c, stub.callRequest(c.method, c.params(prepared)));
            expect(errors, c.name).toEqual(
                c.failure === "" ? [] : [[`[ext-host] ${c.failure} failed: ${String(failure.stack)}`]],
            );
        }
    });

    it("регистрация от имени расширения — строка сбоя несёт его id", async () => {
        for (const c of CASES) {
            errors = [];
            const { stub, languages, owner } = makeStubCtx();
            const failure = new Error(`boom in ${c.name}`);
            // Владелец выставлен только на время регистрации (как делает оверлей);
            // сбой случается позже, вне runAs, — id берётся из записи регистрации.
            owner.runAs("pub.owned", () => {
                c.register(languages, () => {
                    throw failure;
                });
            });
            const prepared = await c.prepare?.((m, p) => stub.callRequest(m, p));
            await settle(c, stub.callRequest(c.method, c.params(prepared)));
            expect(errors, c.name).toEqual(
                c.failure === "" ? [] : [[`[ext-host] [pub.owned] ${c.failure} failed: ${String(failure.stack)}`]],
            );
        }
    });

    it("чужой handle и провайдер без resolve — пустой ответ, а не сбой: stderr молчит", async () => {
        for (const c of CASES) {
            const { stub, languages } = makeStubCtx();
            c.register(languages, () => undefined);
            const params = c.params(await c.prepare?.((m, p) => stub.callRequest(m, p))) as Record<string, unknown>;
            if ("handle" in params) await stub.callRequest(c.method, { ...params, handle: 99 });
            if ("handles" in params) await stub.callRequest(c.method, { ...params, handles: [99] });
            expect(errors, c.name).toEqual([]);
        }
        const { stub, languages } = makeStubCtx();
        languages.registerCompletionItemProvider(SELECTOR, { provideCompletionItems: () => [{ label: "a" }] });
        const [result] = (await stub.callRequest("languages.provideCompletionItems", { ...POS, handles: [0] })) as {
            items: { id: string }[];
        }[];
        expect(await stub.callRequest("languages.resolveCompletionItem", { id: result.items[0].id })).toBeNull();
        expect(errors).toEqual([]);
    });

    it("CancellationError — штатная отмена, не сбой: stderr молчит", async () => {
        for (const c of CASES) {
            const { stub, languages } = makeStubCtx();
            c.register(languages, () => Promise.reject(new CancellationError()));
            const prepared = await c.prepare?.((m, p) => stub.callRequest(m, p));
            await settle(c, stub.callRequest(c.method, c.params(prepared)));
            expect(errors, c.name).toEqual([]);
        }
    });
});

describe("LanguagesNamespace — отмена останавливает обход цепочки провайдеров", () => {
    /** Цепочки: completion и folding (inline — в своём тесте). */
    const CHAINS = CASES.filter((c) => c.method === "languages.provideCompletionItems" || c.name === "folding");

    it("после отмены следующий провайдер не опрашивается", async () => {
        expect(CHAINS.map((c) => c.name)).toEqual(["completion", "folding"]);
        for (const c of CHAINS) {
            const { stub, languages } = makeStubCtx();
            const polled: string[] = [];
            let release: () => void = () => undefined;
            c.register(languages, () => {
                polled.push("A");
                return new Promise((resolve) => {
                    release = () => {
                        resolve(undefined);
                    };
                });
            });
            c.register(languages, () => {
                polled.push("B");
                return [];
            });
            const caller = new CancellationTokenSource();
            const pending = stub.callRequest(
                c.method,
                { ...(c.params(undefined) as object), handles: [0, 1] },
                caller.token,
            );
            await Promise.resolve();
            expect(polled, c.name).toEqual(["A"]);
            caller.cancel();
            release();
            await pending;
            expect(polled, c.name).toEqual(["A"]);
        }
    });

    it("без отмены опрашиваются все", async () => {
        for (const c of CHAINS) {
            const { stub, languages } = makeStubCtx();
            const polled: string[] = [];
            c.register(languages, () => polled.push("A") && []);
            c.register(languages, () => polled.push("B") && []);
            await stub.callRequest(c.method, { ...(c.params(undefined) as object), handles: [0, 1] });
            expect(polled, c.name).toEqual(["A", "B"]);
        }
    });
});
