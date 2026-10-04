import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import type { ILogger } from "../../../../../platform/log/common/iLogger.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import type { IWireDocumentChangedEvent, IWireDocumentSyncSnapshot } from "../../../../api/common/wireTypes.ts";
import type { ISaveSnapshot } from "../../../textfile/common/iSaveParticipant.ts";

import { DocumentsCustomer } from "./documentsCustomer.ts";

// Семантика гейтов document sync: didOpen/didClose — без гейта подписки
// (реестр документов субпроцесса обязан нести полный текст активного ДО
// активации клиента), но только при живом спавне и хоть одном расширении;
// didChange — только при подписке (full-text на каждое нажатие без
// потребителей — расточительно). «Спавна нет» — customer не подключён.

function makeLogger(): { logger: ILogger; lines: string[] } {
    const lines: string[] = [];
    const log =
        (level: string) =>
        (msg: string, ...args: unknown[]) =>
            lines.push(args.length === 0 ? `${level}:${msg}` : `${level}:${msg} ${JSON.stringify(args)}`);
    const logger = {
        trace: log("trace"),
        debug: log("debug"),
        info: log("info"),
        warn: log("warn"),
        error: log("error"),
        isEnabled: () => true,
    } as unknown as ILogger;
    return { logger, lines };
}

/** Порог синхронизации тестов: маленький, чтобы не гонять мегабайтные строки. */
const LIMIT = 10;

function makeCustomer(
    options: {
        attached?: boolean;
        openDocuments?: () => IWireDocumentSyncSnapshot[];
    } = {},
) {
    const { logger, lines } = makeLogger();
    const customer = new DocumentsCustomer({
        willSaveTimeoutMs: 1000,
        openDocumentsProvider: options.openDocuments,
        maxSyncedDocumentChars: LIMIT,
        logger,
    });
    const [a, b] = createInProcessChannelPair();
    const peer = new RpcEndpoint(b);
    const attached = options.attached === false ? null : customer.attach({ rpc: new RpcEndpoint(a), logger });
    const received: { method: string; params: unknown }[] = [];
    for (const method of ["editor.didOpen", "editor.didChange", "editor.didClose", "workspace.didSaveTextDocument"]) {
        peer.handleNotification(method, (p) => received.push({ method, params: p }));
    }
    return { customer, peer, attached, received, logLines: lines };
}

function snap(text = "hello", version = 1): IWireDocumentSyncSnapshot {
    return { uri: "file:///a.ts", languageId: "typescript", version, text };
}

async function subscribe(
    h: ReturnType<typeof makeCustomer>,
    subscriptions: { willSave?: boolean; didSave?: boolean; documentSync?: boolean } = { documentSync: true },
): Promise<void> {
    h.peer.notify("workspace.updateSubscriptions", subscriptions);
    await flushMicrotasks();
}

const SAVE_SNAPSHOT: ISaveSnapshot = {
    uri: "file:///a.ts",
    languageId: "typescript",
    versionId: 7,
    isDirty: true,
    text: "text",
    eol: "\n",
    encoding: "utf8",
} as unknown as ISaveSnapshot;

function delta(uri = "file:///a.ts", version = 2): IWireDocumentChangedEvent {
    return {
        uri,
        version,
        changes: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "x" }],
        isDirty: true,
    };
}

describe("DocumentsCustomer — document sync зеркалом", () => {
    it("без спавна ничего не шлётся", async () => {
        const detached = makeCustomer({ attached: false });
        detached.customer.didOpenTextDocument(snap());
        detached.customer.didChangeTextDocument(snap("b", 2));
        detached.customer.didChangeTextDocumentContent(delta());
        detached.customer.didCloseTextDocument("file:///a.ts");
        await flushMicrotasks();
        expect(detached.received).toEqual([]);
    });

    it("открытие — снапшот; правки — дельтой, сразу и каждая, без подписки на изменения", async () => {
        const h = makeCustomer();
        h.customer.didOpenTextDocument(snap());
        h.customer.didChangeTextDocumentContent(delta("file:///a.ts", 2));
        h.customer.didChangeTextDocumentContent(delta("file:///a.ts", 3));
        await flushMicrotasks();
        expect(h.received).toEqual([
            { method: "editor.didOpen", params: snap() },
            { method: "editor.didChange", params: delta("file:///a.ts", 2) },
            { method: "editor.didChange", params: delta("file:///a.ts", 3) },
        ]);
    });

    it("правки неоткрытого документа не шлются — зеркала у него нет", async () => {
        const h = makeCustomer();
        h.customer.didChangeTextDocumentContent(delta("file:///other.ts"));
        await flushMicrotasks();
        expect(h.received).toEqual([]);
    });

    it("flush открытого — снапшот в didChange; неоткрытого — открытие", async () => {
        const h = makeCustomer();
        h.customer.didOpenTextDocument(snap());
        h.customer.didChangeTextDocument(snap("reloaded", 5));
        const other = { ...snap("b"), uri: "file:///b.ts" };
        h.customer.didChangeTextDocument(other);
        h.customer.didChangeTextDocumentContent(delta("file:///b.ts"));
        await flushMicrotasks();
        expect(h.received.map((r) => r.method)).toEqual([
            "editor.didOpen",
            "editor.didChange",
            "editor.didOpen",
            "editor.didChange",
        ]);
        expect(h.received[1].params).toEqual(snap("reloaded", 5));
        expect(h.received[2].params).toEqual(other);
    });

    it("закрытие — только открытого, после него правки не шлются", async () => {
        const h = makeCustomer();
        h.customer.didCloseTextDocument("file:///a.ts");
        h.customer.didOpenTextDocument(snap());
        h.customer.didCloseTextDocument("file:///a.ts");
        h.customer.didCloseTextDocument("file:///a.ts");
        h.customer.didChangeTextDocumentContent(delta());
        await flushMicrotasks();
        expect(h.received).toEqual([
            { method: "editor.didOpen", params: snap() },
            { method: "editor.didClose", params: { uri: "file:///a.ts" } },
        ]);
    });

    it("уход спавна забывает открытые документы: новому спавну правки не шлются без открытия", async () => {
        const first = makeCustomer();
        first.customer.didOpenTextDocument(snap());
        first.attached?.dispose();
        const [a, b] = createInProcessChannelPair();
        const peer = new RpcEndpoint(b);
        const received: string[] = [];
        peer.handleNotification("editor.didChange", () => received.push("didChange"));
        first.customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
        first.customer.didChangeTextDocumentContent(delta());
        await flushMicrotasks();
        expect(received).toEqual([]);
    });

    it("слишком большой документ не открывается — и логируется; его правки не шлются", async () => {
        const h = makeCustomer();
        const huge = "x".repeat(LIMIT + 1);
        h.customer.didOpenTextDocument(snap(huge));
        h.customer.didChangeTextDocument(snap(huge, 2));
        h.customer.didChangeTextDocumentContent(delta());
        await flushMicrotasks();

        expect(h.received).toEqual([]);
        const warning = `warn:skipping document sync: document too large ${JSON.stringify([{ uri: "file:///a.ts", length: huge.length }])}`;
        expect(h.logLines).toEqual([warning, warning]);
    });

    it("flush, переросший лимит, закрывает документ субпроцессу", async () => {
        const h = makeCustomer();
        h.customer.didOpenTextDocument(snap());
        h.customer.didChangeTextDocument(snap("x".repeat(LIMIT + 1), 2));
        h.customer.didChangeTextDocumentContent(delta());
        await flushMicrotasks();
        expect(h.received).toEqual([
            { method: "editor.didOpen", params: snap() },
            { method: "editor.didClose", params: { uri: "file:///a.ts" } },
        ]);
    });

    it("без логгера слишком большой документ тихо отбрасывается", async () => {
        const customer = new DocumentsCustomer({
            willSaveTimeoutMs: 1000,
            openDocumentsProvider: undefined,
            maxSyncedDocumentChars: LIMIT,
            logger: undefined,
        });
        const [a, b] = createInProcessChannelPair();
        customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
        new RpcEndpoint(b).notify("workspace.updateSubscriptions", { willSave: true });
        await flushMicrotasks();
        const huge = "x".repeat(LIMIT + 1);
        expect(() => {
            customer.didOpenTextDocument(snap(huge));
        }).not.toThrow();
        expect(customer.isSynced("file:///a.ts")).toBe(false);
        await expect(customer.willSaveTextDocument({ ...SAVE_SNAPSHOT, text: huge })).resolves.toEqual([]);
    });

    it("документ ровно на лимите ещё открывается", async () => {
        const h = makeCustomer();
        h.customer.didOpenTextDocument(snap("x".repeat(LIMIT)));
        await flushMicrotasks();
        expect(h.received).toHaveLength(1);
        expect(h.customer.isSynced("file:///a.ts")).toBe(true);
    });
});

describe("DocumentsCustomer — isSynced", () => {
    it("открытие — синхронизирован; закрытие — нет; чужой uri — нет", () => {
        const h = makeCustomer();
        expect(h.customer.isSynced("file:///a.ts")).toBe(false);
        h.customer.didOpenTextDocument(snap());
        expect(h.customer.isSynced("file:///a.ts")).toBe(true);
        expect(h.customer.isSynced("file:///b.ts")).toBe(false);
        h.customer.didCloseTextDocument("file:///a.ts");
        expect(h.customer.isSynced("file:///a.ts")).toBe(false);
    });

    it("без спавна не синхронизирован ничто; уход спавна забывает открытые", () => {
        const detached = makeCustomer({ attached: false });
        detached.customer.didOpenTextDocument(snap());
        expect(detached.customer.isSynced("file:///a.ts")).toBe(false);

        const h = makeCustomer();
        h.customer.didOpenTextDocument(snap());
        h.attached?.dispose();
        expect(h.customer.isSynced("file:///a.ts")).toBe(false);
        // Новый спавн документа не знает, пока его не откроют заново.
        h.customer.attach({ rpc: new RpcEndpoint(createInProcessChannelPair()[0]), logger: undefined });
        expect(h.customer.isSynced("file:///a.ts")).toBe(false);
    });

    it("сверх порога — не синхронизирован: ни на открытии, ни после flush; flush в порог — синхронизирован", () => {
        const h = makeCustomer();
        h.customer.didOpenTextDocument(snap("x".repeat(LIMIT + 1)));
        expect(h.customer.isSynced("file:///a.ts")).toBe(false);
        h.customer.didChangeTextDocument(snap("small", 2));
        expect(h.customer.isSynced("file:///a.ts")).toBe(true);
        h.customer.didChangeTextDocument(snap("x".repeat(LIMIT + 1), 3));
        expect(h.customer.isSynced("file:///a.ts")).toBe(false);
    });

    it("семя handshake синхронизирует открытые документы", () => {
        const h = makeCustomer({ openDocuments: () => [snap("a"), { ...snap("b"), uri: "file:///b.ts" }] });
        h.customer.pushInitialState();
        expect(h.customer.isSynced("file:///a.ts")).toBe(true);
        expect(h.customer.isSynced("file:///b.ts")).toBe(true);
    });

    it("семя соблюдает порог: документ сверх него не открывается, даже если открыт до спавна", async () => {
        const huge = { ...snap("x".repeat(LIMIT + 1)), uri: "file:///huge.ts" };
        const h = makeCustomer({ openDocuments: () => [snap("a"), huge] });
        h.customer.pushInitialState();
        await flushMicrotasks();
        expect(h.received).toEqual([{ method: "editor.didOpen", params: snap("a") }]);
        expect(h.customer.isSynced("file:///huge.ts")).toBe(false);
    });
});

describe("DocumentsCustomer — семя и сохранение", () => {
    it("семя открытых документов уходит живому спавну и открывает их для правок", async () => {
        const docs = [snap("a"), { ...snap("b"), uri: "file:///b.ts" }];
        const h = makeCustomer({ openDocuments: () => docs });
        h.customer.pushInitialState();
        h.customer.didChangeTextDocumentContent(delta("file:///b.ts"));
        await flushMicrotasks();
        expect(h.received).toEqual([
            ...docs.map((params) => ({ method: "editor.didOpen", params })),
            { method: "editor.didChange", params: delta("file:///b.ts") },
        ]);

        const detached = makeCustomer({ attached: false, openDocuments: () => docs });
        detached.customer.pushInitialState();
        const noProvider = makeCustomer();
        noProvider.customer.pushInitialState();
        await flushMicrotasks();
        expect(detached.received).toHaveLength(0);
        expect(noProvider.received).toHaveLength(0);
    });

    it("will-save: без спавна или подписки — пусто; с подпиской — запрос с полями снапшота без текста", async () => {
        const detached = makeCustomer({ attached: false });
        await expect(detached.customer.willSaveTextDocument(SAVE_SNAPSHOT)).resolves.toEqual([]);

        const h = makeCustomer();
        h.customer.didOpenTextDocument(snap());
        const requests: unknown[] = [];
        h.peer.handleRequest("workspace.willSaveTextDocument", (params) => {
            requests.push(params);
            return [];
        });
        await expect(h.customer.willSaveTextDocument(SAVE_SNAPSHOT)).resolves.toEqual([]);
        // Подписки на другое will-save не включают.
        await subscribe(h, { didSave: true, documentSync: true });
        await expect(h.customer.willSaveTextDocument(SAVE_SNAPSHOT)).resolves.toEqual([]);
        expect(requests).toEqual([]);

        await subscribe(h, { willSave: true });
        await expect(h.customer.willSaveTextDocument(SAVE_SNAPSHOT)).resolves.toEqual([]);
        expect(requests).toEqual([
            {
                uri: "file:///a.ts",
                languageId: "typescript",
                version: 7,
                isDirty: true,
                reason: 1,
                eol: "\n",
                encoding: "utf8",
            },
        ]);
    });

    it("will-save: только синхронизированному документу — неоткрытый, сверх порога и закрытый без запроса", async () => {
        const h = makeCustomer();
        const uris: string[] = [];
        h.peer.handleRequest("workspace.willSaveTextDocument", (params) => {
            uris.push((params as { uri: string }).uri);
            return [];
        });
        await subscribe(h, { willSave: true });

        // Не открыт субпроцессу.
        await expect(h.customer.willSaveTextDocument(SAVE_SNAPSHOT)).resolves.toEqual([]);
        // Сверх порога — не синхронизирован.
        h.customer.didOpenTextDocument(snap("x".repeat(LIMIT + 1)));
        await expect(h.customer.willSaveTextDocument(SAVE_SNAPSHOT)).resolves.toEqual([]);
        expect(uris).toEqual([]);

        // Ровно на пороге — синхронизирован, запрос уходит.
        h.customer.didOpenTextDocument(snap("x".repeat(LIMIT)));
        await expect(h.customer.willSaveTextDocument(SAVE_SNAPSHOT)).resolves.toEqual([]);
        expect(uris).toEqual(["file:///a.ts"]);

        // Закрыт — снова без запроса.
        h.customer.didCloseTextDocument("file:///a.ts");
        await expect(h.customer.willSaveTextDocument(SAVE_SNAPSHOT)).resolves.toEqual([]);
        expect(uris).toEqual(["file:///a.ts"]);
    });

    it("did-save уходит только подписанному живому спавну", async () => {
        const meta = { uri: "file:///a.ts", languageId: "typescript" };
        const detached = makeCustomer({ attached: false });
        detached.customer.didSaveTextDocument(meta);
        const h = makeCustomer();
        h.customer.didSaveTextDocument(meta);
        await subscribe(h, { willSave: true, documentSync: true });
        h.customer.didSaveTextDocument(meta);
        await flushMicrotasks();
        expect(detached.received).toHaveLength(0);
        expect(h.received).toHaveLength(0);

        await subscribe(h, { didSave: true });
        h.customer.didSaveTextDocument(meta);
        await flushMicrotasks();
        expect(h.received).toEqual([{ method: "workspace.didSaveTextDocument", params: meta }]);

        h.attached?.dispose();
        h.customer.didSaveTextDocument(meta);
        await flushMicrotasks();
        expect(h.received).toHaveLength(1);
    });
});
