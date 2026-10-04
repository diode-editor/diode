import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import type { ILogger } from "../../../../../platform/log/common/iLogger.ts";
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
    const customer = new LanguageFeaturesCustomer(TIMEOUTS, undefined);
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

const LIMIT = 8 * 1024 * 1024;

/** Запрос, годный любому провайдеру: лишние поля провайдеры не читают. */
function anyRequest(text: string): never {
    return {
        uri: "file:///a.ts",
        languageId: "typescript",
        text,
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
    readonly call: (customer: LanguageFeaturesCustomer, text: string) => Promise<unknown>;
    readonly empty: unknown;
}

const REQUEST_CASES: readonly IRequestCase[] = [
    {
        name: "completion",
        method: "languages.provideCompletionItems",
        call: (c, t) => c.provideCompletionItems(1, anyRequest(t)),
        empty: { items: [], isIncomplete: false },
    },
    {
        name: "inline completion",
        method: "languages.provideInlineCompletions",
        call: (c, t) => c.provideInlineCompletions(1, anyRequest(t)),
        empty: [],
    },
    {
        name: "folding",
        method: "languages.provideFoldingRanges",
        call: (c, t) => c.provideFoldingRanges(1, anyRequest(t)),
        empty: [],
    },
    {
        name: "definition",
        method: "languages.provideDefinition",
        call: (c, t) => c.provideDefinition(1, anyRequest(t)),
        empty: [],
    },
    {
        name: "hover",
        method: "languages.provideHover",
        call: (c, t) => c.provideHover(1, anyRequest(t)),
        empty: undefined,
    },
    {
        name: "references",
        method: "languages.provideReferences",
        call: (c, t) => c.provideReferences(1, anyRequest(t)),
        empty: [],
    },
    {
        name: "signature help",
        method: "languages.provideSignatureHelp",
        call: (c, t) => c.provideSignatureHelp(1, anyRequest(t)),
        empty: null,
    },
    {
        name: "formatting",
        method: "languages.provideFormattingEdits",
        call: (c, t) => c.provideFormattingEdits(1, anyRequest(t)),
        empty: [],
    },
    {
        name: "code actions",
        method: "languages.provideCodeActions",
        call: (c, t) => c.provideCodeActions(1, anyRequest(t)),
        empty: [],
    },
    {
        name: "prepare rename",
        method: "languages.prepareRename",
        call: (c, t) => c.prepareRename(1, anyRequest(t)),
        empty: null,
    },
    {
        name: "rename",
        method: "languages.provideRenameEdits",
        call: (c, t) => c.provideRenameEdits(1, anyRequest(t), "renamed"),
        empty: { applied: false, error: "Document too large to rename" },
    },
];

function setupWithLogger(logger: ILogger | undefined) {
    const customer = new LanguageFeaturesCustomer(TIMEOUTS, logger);
    const [a, b] = createInProcessChannelPair();
    const peer = new RpcEndpoint(b);
    customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
    const requested: string[] = [];
    for (const { method } of REQUEST_CASES) {
        peer.handleRequest(method, () => {
            requested.push(method);
            return null;
        });
    }
    return { customer, requested };
}

// Без it.each: имена-параметры мутационный раннер может не найти по фильтру имени.
describe("LanguageFeaturesCustomer — защитный лимит снапшота 8 МБ", () => {
    it("слишком большой документ: пустой ответ без запроса и предупреждение с uri и длиной", async () => {
        const warn = vi.fn();
        const h = setupWithLogger({ warn } as unknown as ILogger);
        const huge = "x".repeat(LIMIT + 1);
        for (const c of REQUEST_CASES) {
            await expect(c.call(h.customer, huge), c.name).resolves.toEqual(c.empty);
        }
        expect(h.requested).toEqual([]);
        expect(warn.mock.calls).toEqual(
            REQUEST_CASES.map((c) => [
                `skipping ${c.name}: document too large`,
                { uri: "file:///a.ts", length: LIMIT + 1 },
            ]),
        );
    });

    it("документ ровно на лимите уходит провайдеру", async () => {
        const h = setupWithLogger(undefined);
        const atLimit = "x".repeat(LIMIT);
        for (const c of REQUEST_CASES) await c.call(h.customer, atLimit);
        expect(h.requested).toEqual(REQUEST_CASES.map((c) => c.method));
    });

    it("без логгера слишком большой документ отбрасывается без падения", async () => {
        const h = setupWithLogger(undefined);
        const huge = "x".repeat(LIMIT + 1);
        for (const c of REQUEST_CASES) {
            await expect(c.call(h.customer, huge), c.name).resolves.toEqual(c.empty);
        }
    });
});
