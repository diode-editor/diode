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
        changes: [{ range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 }, text: "x" }],
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
        const huge = "x".repeat(8 * 1024 * 1024 + 1);
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
        h.customer.didChangeTextDocument(snap("x".repeat(8 * 1024 * 1024 + 1), 2));
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
            logger: undefined,
        });
        const [a, b] = createInProcessChannelPair();
        customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
        new RpcEndpoint(b).notify("workspace.updateSubscriptions", { willSave: true });
        await flushMicrotasks();
        const huge = "x".repeat(8 * 1024 * 1024 + 1);
        expect(() => {
            customer.didOpenTextDocument(snap(huge));
        }).not.toThrow();
        await expect(customer.willSaveTextDocument({ ...SAVE_SNAPSHOT, text: huge })).resolves.toEqual([]);
    });

    it("документ ровно на лимите ещё открывается", async () => {
        const h = makeCustomer();
        h.customer.didOpenTextDocument(snap("x".repeat(8 * 1024 * 1024)));
        await flushMicrotasks();
        expect(h.received).toHaveLength(1);
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

    it("will-save: без спавна или подписки — пусто; с подпиской — запрос с полями снапшота", async () => {
        const detached = makeCustomer({ attached: false });
        await expect(detached.customer.willSaveTextDocument(SAVE_SNAPSHOT)).resolves.toEqual([]);

        const h = makeCustomer();
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
                text: "text",
                reason: 1,
                eol: "\n",
                encoding: "utf8",
            },
        ]);
    });

    it("will-save: слишком большой документ — пусто и предупреждение, ровно на лимите — запрос уходит", async () => {
        const h = makeCustomer();
        const lengths: number[] = [];
        h.peer.handleRequest("workspace.willSaveTextDocument", (params) => {
            lengths.push((params as { text: string }).text.length);
            return [];
        });
        await subscribe(h, { willSave: true });
        const limit = 8 * 1024 * 1024;

        await expect(
            h.customer.willSaveTextDocument({ ...SAVE_SNAPSHOT, text: "x".repeat(limit + 1) }),
        ).resolves.toEqual([]);
        await expect(h.customer.willSaveTextDocument({ ...SAVE_SNAPSHOT, text: "x".repeat(limit) })).resolves.toEqual(
            [],
        );

        expect(lengths).toEqual([limit]);
        expect(h.logLines).toEqual([
            `warn:skipping will-save participant: document too large ${JSON.stringify([{ uri: "file:///a.ts", length: limit + 1 }])}`,
        ]);
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
