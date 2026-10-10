import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import { CancellationTokenNone, CancellationTokenSource } from "../../../../../base/common/cancellation.ts";
import type { HostRpc } from "../../../../api/common/extHostProtocol.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import { DEFAULT_REQUEST_TIMEOUTS, type RequestTimeouts } from "../requestPolicy.ts";

import { LanguageFeaturesCustomer } from "./languageFeaturesCustomer.ts";

// Короткие сроки: висящий ответ в этих тестах не должен держать прогон.
/** Разные сроки у каждого метода: перепутанный ключ таблицы виден в опциях запроса. */
const TIMEOUTS: RequestTimeouts = {
    ...DEFAULT_REQUEST_TIMEOUTS,
    "languages.resolveCompletionItem": 102,
    "languages.provideInlineCompletions": 103,
    "languages.provideFoldingRanges": 104,
    "languages.provideDefinition": 105,
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

describe("LanguageFeaturesCustomer — реестр провайдеров спавна", () => {
    it("регистрация и снятие меняют состав с событием; мусор и чужой handle — без события", async () => {
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

    it("уход спавна снимает его провайдеров с событием; пустой спавн уходит молча", async () => {
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

    it("getProviders отдаёт снимок, а не живую коллекцию", async () => {
        const h = setup();
        h.peer.notify("languages.register", HOVER);
        await flushMicrotasks();
        const snapshot = h.customer.getProviders();
        h.peer.notify("languages.register", COMPLETION);
        await flushMicrotasks();
        expect(snapshot).toEqual([HOVER]);
    });
});

/** Запрос, годный любому провайдеру: лишние поля провайдеры не читают. */
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

/** Пустой ответ субпроцесса каждого метода в форме карты протокола. */
const EMPTY_WIRE: Readonly<Record<string, unknown>> = {
    "languages.provideCompletionItems": [],
    "languages.resolveCompletionItem": null,
    "languages.provideInlineCompletions": [],
    "languages.provideFoldingRanges": [],
    "languages.provideDefinition": [],
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
    // Опции запроса (срок) видны только на стороне хоста.
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

// Без it.each: имена-параметры мутационный раннер может не найти по фильтру имени.
describe("LanguageFeaturesCustomer — запросы только по синхронизированным документам", () => {
    it("документ не синхронизирован: пустой ответ каждого вида без RPC", async () => {
        const h = setupWithSync();
        for (const c of REQUEST_CASES) {
            await expect(c.call(h.customer, UNSYNCED), c.name).resolves.toEqual(c.empty);
        }
        expect(h.requested).toEqual([]);
        // Спросили про документ запроса — по разу на вид.
        expect(h.asked).toEqual(REQUEST_CASES.map(() => UNSYNCED));
    });

    it("синхронизированный документ: запрос уходит с version из versionId и без text", async () => {
        const h = setupWithSync();
        for (const c of REQUEST_CASES) await c.call(h.customer, SYNCED);
        expect(h.requested.map((r) => r.method)).toEqual(REQUEST_CASES.map((c) => c.method));
        for (const { method, params } of h.requested) {
            expect(params, method).toMatchObject({ uri: SYNCED, version: 7 });
            expect(params, method).not.toHaveProperty("text");
        }
    });

    it("документ, позиция и адресация провайдера уходят по проводу в wire-форме", async () => {
        const h = setupWithSync();
        for (const c of REQUEST_CASES) await c.call(h.customer, SYNCED);
        // Пачечные запросы адресуют провайдеров списком, остальные — одним handle.
        const batched = new Set([
            "languages.provideCompletionItems",
            "languages.provideInlineCompletions",
            "languages.provideFoldingRanges",
        ]);
        // Без позиции — запросы по документу или диапазону.
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

    it("срок ответа каждого запроса — из таблицы по его методу (резолв и применение — свои ключи)", async () => {
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
        // У автодополнения срока нет: его ожидание ограничивает только токен вызывающего.
        expect(seen).toContainEqual(["languages.provideCompletionItems", undefined]);
        expect(seen.filter(([, timeoutMs]) => timeoutMs === undefined)).toHaveLength(1);
    });
});

/** Диапазон ответов и правок на проводе — core `IRange`. */
const CORE_RANGE = { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } };

type Answer = (params: unknown) => unknown;

/** Customer поверх субпроцесса с заданными ответами; документ синхронизирован. */
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

/** Все языковые методы отвечают одинаково. */
function answerAll(answer: Answer): Record<string, Answer> {
    return Object.fromEntries(Object.keys(EMPTY_WIRE).map((method) => [method, answer]));
}

/** Пустой ответ каждого вида: rename — отказ С сообщением о причине, остальные — как у несинхронизированного. */
function emptyResult(c: IRequestCase, renameError: string): unknown {
    return c.method === "languages.provideRenameEdits" ? { applied: false, error: renameError } : c.empty;
}

describe("LanguageFeaturesCustomer — ответ субпроцесса в форме ядра", () => {
    it("пачечные ответы выровнены по провайдерам: недостающий элемент — пусто у своего", async () => {
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
        // Пачку собирает один и тот же запрос к нескольким провайдерам.
        const req = anyRequest(SYNCED);
        expect(await Promise.all([c.provideCompletionItems(1, req), c.provideCompletionItems(2, req)])).toEqual([
            { items: [{ label: "a", insertText: "a", range: CORE_RANGE }], isIncomplete: true },
            { items: [], isIncomplete: false },
        ]);
        expect(await Promise.all([c.provideInlineCompletions(1, req), c.provideInlineCompletions(2, req)])).toEqual([
            [{ insertText: "x", range: CORE_RANGE }],
            [],
        ]);
        // Вырожденная область отсеивается переводом в регионы ядра.
        expect(await Promise.all([c.provideFoldingRanges(1, req), c.provideFoldingRanges(2, req)])).toEqual([
            [{ startLine: 1, endLine: 4, isCollapsed: false }],
            [],
        ]);
    });

    it("одиночные ответы переводятся в форму ядра", async () => {
        const h = setupAnswering({
            "languages.resolveCompletionItem": () => ({
                detail: "d",
                additionalEdits: [{ range: CORE_RANGE, text: "import x\n" }],
            }),
            "languages.provideDefinition": () => [{ uri: "file:///b.ts", range: CORE_RANGE }],
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

    it("«сказать нечего» субпроцесса — пусто в форме ядра", async () => {
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

describe("LanguageFeaturesCustomer — сбой запроса", () => {
    it("отказ RPC — пустой ответ каждого вида; rename — отказ С сообщением", async () => {
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

    it("истёкший срок — пустой ответ, человек узнаёт о несостоявшемся rename", async () => {
        const h = setupAnswering(answerAll(() => new Promise<never>(() => undefined)));
        await expect(h.customer.provideHover(1, anyRequest(SYNCED))).resolves.toBeUndefined();
        await expect(h.customer.provideRenameEdits(1, anyRequest(SYNCED), "renamed")).resolves.toEqual({
            applied: false,
            error: "Rename timed out",
        });
    });

    it("спавна нет — пустой ответ каждого вида без вопроса о синхронизации", async () => {
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

describe("LanguageFeaturesCustomer — опции запроса inline completions", () => {
    it("срок из самого запроса и токен ядра уезжают в options; без срока — табличный", async () => {
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
        // Остальные запросы токена не несут — в options его ключа нет вовсе.
        await h.customer.provideHover(1, anyRequest(SYNCED));
        expect(h.sent.mock.calls.at(-1)?.[2]).toStrictEqual({ timeoutMs: TIMEOUTS["languages.provideHover"] });
    });
});

describe("LanguageFeaturesCustomer — семантические токены", () => {
    const REQ = { uri: SYNCED, languageId: "typescript", versionId: 7 };
    const RANGE_REQ = { ...REQ, range: CORE_RANGE };

    it("документ: параметры провода, без срока; ответ — в форме ядра с resultId строкой", async () => {
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

    it("диапазон: диапазон уходит по проводу; дельта в ответе — исключение Unexpected", async () => {
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

    it("отказ RPC — исключение (а не null): прежние токены остаются у потребителя", async () => {
        const h = setupAnswering({
            "languages.provideDocumentSemanticTokens": () => Promise.reject(new Error("busy")),
            "languages.provideDocumentRangeSemanticTokens": () => Promise.reject(new Error("down")),
        });
        await expect(h.customer.provideDocumentSemanticTokens(1, REQ, 0)).rejects.toThrow("busy");
        await expect(h.customer.provideDocumentRangeSemanticTokens(1, RANGE_REQ)).rejects.toThrow("down");
    });

    it("спавна нет или документ не синхронизирован — null без RPC", async () => {
        const noHost = new LanguageFeaturesCustomer(TIMEOUTS, () => true, undefined);
        expect(await noHost.provideDocumentSemanticTokens(1, REQ, 0)).toBeNull();
        expect(await noHost.provideDocumentRangeSemanticTokens(1, RANGE_REQ)).toBeNull();
        // Без спавна release молчит.
        noHost.releaseDocumentSemanticTokens(1, 2);

        const h = setupWithSync();
        const unsynced = { ...REQ, uri: UNSYNCED };
        expect(await h.customer.provideDocumentSemanticTokens(1, unsynced, 0)).toBeNull();
        expect(await h.customer.provideDocumentRangeSemanticTokens(1, { ...unsynced, range: CORE_RANGE })).toBeNull();
        expect(h.sent).not.toHaveBeenCalled();
    });

    it("releaseDocumentSemanticTokens уходит нотификацией с handle и id", async () => {
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

    it("onDidChangeSemanticTokens — только для объявленного handle", async () => {
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
