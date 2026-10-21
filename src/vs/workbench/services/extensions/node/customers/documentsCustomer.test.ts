import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import type { ILogger } from "../../../../../platform/log/common/iLogger.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import type { IWireDocumentChangedEvent, IWireDocumentSyncSnapshot } from "../../../../api/common/wireTypes.ts";
import type { ISaveSnapshot } from "../../../textfile/common/iSaveParticipant.ts";

import { DocumentsCustomer } from "./documentsCustomer.ts";

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

describe("DocumentsCustomer — mirrored document sync", () => {
    it("without a spawn nothing is sent", async () => {
        const detached = makeCustomer({ attached: false });
        detached.customer.didOpenTextDocument(snap());
        detached.customer.didChangeTextDocument(snap("b", 2));
        detached.customer.didChangeTextDocumentContent(delta());
        detached.customer.didCloseTextDocument("file:///a.ts");
        await flushMicrotasks();
        expect(detached.received).toEqual([]);
    });

    it("open sends a snapshot; edits go as deltas, immediately and each one, without a change subscription", async () => {
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

    it("edits of an unopened document are not sent — it has no mirror", async () => {
        const h = makeCustomer();
        h.customer.didChangeTextDocumentContent(delta("file:///other.ts"));
        await flushMicrotasks();
        expect(h.received).toEqual([]);
    });

    it("flush of an opened one — snapshot in didChange; of an unopened one — open", async () => {
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

    it("close — only an opened one, no edits are sent after it", async () => {
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

    it("spawn exit forgets opened documents: edits are not sent to a new spawn without an open", async () => {
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

    it("a too-large document is not opened and is logged; its edits are not sent", async () => {
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

    it("a flush that outgrows the limit closes the document for the subprocess", async () => {
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

    it("without a logger a too-large document is dropped silently", async () => {
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

    it("a document exactly at the limit still opens", async () => {
        const h = makeCustomer();
        h.customer.didOpenTextDocument(snap("x".repeat(LIMIT)));
        await flushMicrotasks();
        expect(h.received).toHaveLength(1);
        expect(h.customer.isSynced("file:///a.ts")).toBe(true);
    });
});

describe("DocumentsCustomer — isSynced", () => {
    it("open — synced; close — not; foreign uri — not", () => {
        const h = makeCustomer();
        expect(h.customer.isSynced("file:///a.ts")).toBe(false);
        h.customer.didOpenTextDocument(snap());
        expect(h.customer.isSynced("file:///a.ts")).toBe(true);
        expect(h.customer.isSynced("file:///b.ts")).toBe(false);
        h.customer.didCloseTextDocument("file:///a.ts");
        expect(h.customer.isSynced("file:///a.ts")).toBe(false);
    });

    it("without a spawn nothing is synced; spawn exit forgets opened ones", () => {
        const detached = makeCustomer({ attached: false });
        detached.customer.didOpenTextDocument(snap());
        expect(detached.customer.isSynced("file:///a.ts")).toBe(false);

        const h = makeCustomer();
        h.customer.didOpenTextDocument(snap());
        h.attached?.dispose();
        expect(h.customer.isSynced("file:///a.ts")).toBe(false);
        // A new spawn doesn't know the document until it is reopened.
        h.customer.attach({ rpc: new RpcEndpoint(createInProcessChannelPair()[0]), logger: undefined });
        expect(h.customer.isSynced("file:///a.ts")).toBe(false);
    });

    it("over the threshold — not synced: neither on open nor after flush; flush within the threshold — synced", () => {
        const h = makeCustomer();
        h.customer.didOpenTextDocument(snap("x".repeat(LIMIT + 1)));
        expect(h.customer.isSynced("file:///a.ts")).toBe(false);
        h.customer.didChangeTextDocument(snap("small", 2));
        expect(h.customer.isSynced("file:///a.ts")).toBe(true);
        h.customer.didChangeTextDocument(snap("x".repeat(LIMIT + 1), 3));
        expect(h.customer.isSynced("file:///a.ts")).toBe(false);
    });

    it("the handshake seed syncs opened documents", () => {
        const h = makeCustomer({ openDocuments: () => [snap("a"), { ...snap("b"), uri: "file:///b.ts" }] });
        h.customer.pushInitialState();
        expect(h.customer.isSynced("file:///a.ts")).toBe(true);
        expect(h.customer.isSynced("file:///b.ts")).toBe(true);
    });

    it("the seed respects the threshold: a document over it is not opened, even if opened before the spawn", async () => {
        const huge = { ...snap("x".repeat(LIMIT + 1)), uri: "file:///huge.ts" };
        const h = makeCustomer({ openDocuments: () => [snap("a"), huge] });
        h.customer.pushInitialState();
        await flushMicrotasks();
        expect(h.received).toEqual([{ method: "editor.didOpen", params: snap("a") }]);
        expect(h.customer.isSynced("file:///huge.ts")).toBe(false);
    });
});

describe("DocumentsCustomer — seed and save", () => {
    it("the seed of opened documents goes to a live spawn and opens them for edits", async () => {
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

    it("will-save: without a spawn or subscription — empty; with a subscription — a request with snapshot fields without text", async () => {
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
        // Other subscriptions don't enable will-save.
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

    it("will-save: only for a synced document — unopened, over-threshold and closed ones get no request", async () => {
        const h = makeCustomer();
        const uris: string[] = [];
        h.peer.handleRequest("workspace.willSaveTextDocument", (params) => {
            uris.push((params as { uri: string }).uri);
            return [];
        });
        await subscribe(h, { willSave: true });

        await expect(h.customer.willSaveTextDocument(SAVE_SNAPSHOT)).resolves.toEqual([]);
        h.customer.didOpenTextDocument(snap("x".repeat(LIMIT + 1)));
        await expect(h.customer.willSaveTextDocument(SAVE_SNAPSHOT)).resolves.toEqual([]);
        expect(uris).toEqual([]);

        h.customer.didOpenTextDocument(snap("x".repeat(LIMIT)));
        await expect(h.customer.willSaveTextDocument(SAVE_SNAPSHOT)).resolves.toEqual([]);
        expect(uris).toEqual(["file:///a.ts"]);

        h.customer.didCloseTextDocument("file:///a.ts");
        await expect(h.customer.willSaveTextDocument(SAVE_SNAPSHOT)).resolves.toEqual([]);
        expect(uris).toEqual(["file:///a.ts"]);
    });

    it("did-save goes only to a subscribed live spawn", async () => {
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
