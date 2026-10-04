import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";

import { LanguageFeaturesCustomer } from "./languageFeaturesCustomer.ts";

const TIMEOUTS = {
    completionTimeoutMs: 100,
    inlineCompletionTimeoutMs: 100,
    foldingTimeoutMs: 100,
    definitionTimeoutMs: 100,
    hoverTimeoutMs: 100,
    referencesTimeoutMs: 100,
    signatureHelpTimeoutMs: 100,
    formattingTimeoutMs: 100,
    codeActionsTimeoutMs: 100,
    applyCodeActionTimeoutMs: 100,
    prepareRenameTimeoutMs: 100,
    renameTimeoutMs: 100,
};
const HOVER = { handle: 1, kind: "hover", selector: [{ language: "typescript" }] };
const COMPLETION = { handle: 2, kind: "completion", selector: [], triggerCharacters: ["."] };

function setup() {
    const customer = new LanguageFeaturesCustomer(TIMEOUTS, () => true);
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
        line: 0,
        character: 0,
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

const SYNCED = "file:///synced.ts";
const UNSYNCED = "file:///unsynced.ts";

function setupWithSync() {
    const asked: string[] = [];
    const customer = new LanguageFeaturesCustomer(TIMEOUTS, (uri) => {
        asked.push(uri);
        return uri === SYNCED;
    });
    const [a, b] = createInProcessChannelPair();
    const peer = new RpcEndpoint(b);
    customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
    const requested: { method: string; params: Record<string, unknown> }[] = [];
    for (const { method } of REQUEST_CASES) {
        peer.handleRequest(method, (params) => {
            requested.push({ method, params: params as Record<string, unknown> });
            return null;
        });
    }
    return { customer, requested, asked };
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
});
