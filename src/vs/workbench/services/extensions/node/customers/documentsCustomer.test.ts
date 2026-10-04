import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import type { ILogger } from "../../../../../platform/log/common/iLogger.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import type { IWireDocumentSyncSnapshot } from "../../../../api/common/wireTypes.ts";
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
        withExtension?: boolean;
        openDocuments?: () => IWireDocumentSyncSnapshot[];
    } = {},
) {
    const { logger, lines } = makeLogger();
    const customer = new DocumentsCustomer({
        willSaveTimeoutMs: 1000,
        openDocumentsProvider: options.openDocuments,
        hasExtensions: () => options.withExtension !== false,
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

describe("DocumentsCustomer — гейты document sync", () => {
    it("didOpen шлётся без подписки (нужен только живой спавн с расширением)", async () => {
        const detached = makeCustomer({ attached: false });
        detached.customer.didOpenTextDocument(snap());
        const noExtension = makeCustomer({ withExtension: false });
        noExtension.customer.didOpenTextDocument(snap());
        const h = makeCustomer();
        h.customer.didOpenTextDocument(snap());
        await flushMicrotasks();

        expect(detached.received).toHaveLength(0);
        expect(noExtension.received).toHaveLength(0);
        expect(h.received).toEqual([{ method: "editor.didOpen", params: snap() }]);
    });

    it("didChange гейтится подпиской; подписка включает push, отписка выключает", async () => {
        const h = makeCustomer();
        h.customer.didChangeTextDocument(snap("a", 2));
        await flushMicrotasks();
        expect(h.received).toHaveLength(0);

        await subscribe(h);
        h.customer.didChangeTextDocument(snap("ab", 3));
        await flushMicrotasks();
        expect(h.received).toEqual([{ method: "editor.didChange", params: snap("ab", 3) }]);

        await subscribe(h, { documentSync: false });
        h.customer.didChangeTextDocument(snap("abc", 4));
        await flushMicrotasks();
        expect(h.received).toHaveLength(1);
    });

    it("didChange без спавна — no-op", async () => {
        const detached = makeCustomer({ attached: false });
        detached.customer.didChangeTextDocument(snap());
        await flushMicrotasks();
        expect(detached.received).toHaveLength(0);
    });

    it("didChange коалесируется в пределах тика: последний снапшот документа побеждает", async () => {
        const h = makeCustomer();
        await subscribe(h);

        h.customer.didChangeTextDocument(snap("a", 2));
        h.customer.didChangeTextDocument(snap("ab", 3));
        h.customer.didChangeTextDocument({ ...snap("b", 1), uri: "file:///b.ts" });
        h.customer.didChangeTextDocument(snap("abc", 4));
        await flushMicrotasks();
        expect(h.received).toEqual([
            { method: "editor.didChange", params: snap("abc", 4) },
            { method: "editor.didChange", params: { ...snap("b", 1), uri: "file:///b.ts" } },
        ]);

        // Следующий тик — отдельная нотификация.
        h.customer.didChangeTextDocument(snap("abcd", 5));
        await flushMicrotasks();
        expect(h.received).toHaveLength(3);
    });

    it("отложенный didChange не уходит, если спавн успел уйти", async () => {
        const h = makeCustomer();
        await subscribe(h);

        h.customer.didChangeTextDocument(snap("late", 2));
        h.attached?.dispose();
        await flushMicrotasks();

        expect(h.received).toHaveLength(0);
    });

    it("didClose шлётся без подписки и отменяет отложенный didChange того же документа", async () => {
        const h = makeCustomer();
        await subscribe(h);

        h.customer.didChangeTextDocument(snap("stale", 2));
        h.customer.didCloseTextDocument("file:///a.ts");
        await flushMicrotasks();

        expect(h.received).toEqual([{ method: "editor.didClose", params: { uri: "file:///a.ts" } }]);
    });

    it("didClose без спавна или без расширений — no-op", async () => {
        const detached = makeCustomer({ attached: false });
        detached.customer.didCloseTextDocument("file:///a.ts");
        const noExtension = makeCustomer({ withExtension: false });
        noExtension.customer.didCloseTextDocument("file:///a.ts");
        await flushMicrotasks();

        expect(detached.received).toHaveLength(0);
        expect(noExtension.received).toHaveLength(0);
    });

    it("слишком большой документ не пушится ни didOpen, ни didChange — и логируется", async () => {
        const h = makeCustomer();
        await subscribe(h);

        const huge = "x".repeat(8 * 1024 * 1024 + 1);
        h.customer.didOpenTextDocument(snap(huge));
        h.customer.didChangeTextDocument(snap(huge, 2));
        await flushMicrotasks();

        expect(h.received).toHaveLength(0);
        const warning = `warn:skipping document sync: document too large ${JSON.stringify([{ uri: "file:///a.ts", length: huge.length }])}`;
        expect(h.logLines).toEqual([warning, warning]);
    });

    it("без логгера слишком большой документ тихо отбрасывается", async () => {
        const customer = new DocumentsCustomer({
            willSaveTimeoutMs: 1000,
            openDocumentsProvider: undefined,
            hasExtensions: () => true,
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

    it("документ ровно на лимите ещё пушится", async () => {
        const h = makeCustomer();
        h.customer.didOpenTextDocument(snap("x".repeat(8 * 1024 * 1024)));
        await flushMicrotasks();
        expect(h.received).toHaveLength(1);
    });
});

describe("DocumentsCustomer — семя и сохранение", () => {
    it("семя открытых документов уходит живому спавну мимо гейтов", async () => {
        const docs = [snap("a"), { ...snap("b"), uri: "file:///b.ts" }];
        const h = makeCustomer({ withExtension: false, openDocuments: () => docs });
        h.customer.pushInitialState();
        await flushMicrotasks();
        expect(h.received).toEqual(docs.map((params) => ({ method: "editor.didOpen", params })));

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
