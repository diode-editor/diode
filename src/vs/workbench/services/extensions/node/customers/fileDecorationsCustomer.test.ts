import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Uri } from "../../../../../base/common/uri.ts";
import type { SubprocessRpc } from "../../../../api/common/extHostProtocol.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import type { IWireProvideFileDecorations, WireFileDecorationReply } from "../../../../api/common/wireTypes.ts";
import { DECORATION_CHANGE_DEBOUNCE_MS, DecorationsService } from "../../../decorations/common/decorationsService.ts";

import { FileDecorationsCustomer } from "./fileDecorationsCustomer.ts";

const file = (path: string): Uri => Uri.file(path);

/** The subprocess side: answers `window.provideFileDecorations` from a table by uri and records each batch. */
function setup() {
    const service = new DecorationsService();
    const customer = new FileDecorationsCustomer(service);
    const [a, b] = createInProcessChannelPair();
    const peer: SubprocessRpc = new RpcEndpoint(b);
    const batches: IWireProvideFileDecorations[] = [];
    const table = new Map<string, WireFileDecorationReply[number]>();
    let failing = false;
    peer.handleRequest("window.provideFileDecorations", (params) => {
        batches.push(params);
        if (failing) return Promise.reject(new Error("spawn gone"));
        const reply: Record<number, WireFileDecorationReply[number]> = {};
        for (const { id, uri } of params.requests) {
            const data = table.get(uri);
            if (data !== undefined) reply[id] = data;
        }
        return reply;
    });
    const attached = customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
    return {
        service,
        peer,
        attached,
        batches,
        table,
        fail: () => {
            failing = true;
        },
        register: (handle = 1, extensionId = "ext.id") => {
            peer.notify("window.registerFileDecorationProvider", { handle, extensionId });
        },
    };
}

describe("FileDecorationsCustomer", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    async function settle(): Promise<void> {
        await vi.advanceTimersByTimeAsync(DECORATION_CHANGE_DEBOUNCE_MS);
    }

    it("a registered provider is asked about what is shown; its answer reaches the service with its fields", async () => {
        const h = setup();
        h.register();
        await settle();
        h.table.set(file("/w/a.pull").toString(), {
            badge: "P",
            colorId: "charts.red",
            tooltip: "pulled",
            propagate: true,
        });

        expect(h.service.getDecoration(file("/w/a.pull"), false)).toBeUndefined();
        await settle();
        expect(h.batches).toEqual([{ handle: 1, requests: [{ id: 1, uri: file("/w/a.pull").toString() }] }]);
        expect(h.service.getDecoration(file("/w/a.pull"), false)).toEqual({
            color: "charts.red",
            badge: "P",
            tooltip: "pulled",
        });
        expect(h.service.getDecoration(file("/w"), true)?.badge).toBe("●");
    });

    it("propagate defaults to no bubbling", async () => {
        const h = setup();
        h.register();
        await settle();
        h.table.set(file("/w/a.txt").toString(), { badge: "A" });
        h.service.getDecoration(file("/w/a.txt"), false);
        await settle();
        expect(h.service.getDecoration(file("/w/a.txt"), false)?.badge).toBe("A");
        expect(h.service.getDecoration(file("/w"), true)).toBeUndefined();
    });

    it("the requests of one tick go as one batch: 1000 files, one request; asking again, none", async () => {
        const h = setup();
        h.register();
        await settle();
        const paths = Array.from({ length: 1000 }, (_, i) => `/w/f${String(i)}.ts`);
        for (const path of paths) h.service.getDecoration(file(path), false);
        await settle();
        expect(h.batches).toHaveLength(1);
        expect(h.batches[0].requests).toHaveLength(1000);

        for (const path of paths) h.service.getDecoration(file(path), false);
        await settle();
        expect(h.batches).toHaveLength(1);
    });

    it("every provider has its own queue and handle", async () => {
        const h = setup();
        h.register(1);
        h.register(2, "other.ext");
        await settle();
        h.service.getDecoration(file("/w/a"), false);
        await settle();
        expect(h.batches.map((batch) => batch.handle).sort()).toEqual([1, 2]);
    });

    it("a change list from the subprocess asks those resources again; null drops the cache", async () => {
        const h = setup();
        h.register();
        await settle();
        const uri = file("/w/deep/a.ts").toString();
        h.table.set(uri, { badge: "M", propagate: true });
        h.peer.notify("window.fileDecorationsChanged", { handle: 1, uris: [uri] });
        await settle();
        expect(h.batches.at(-1)?.requests.map((r) => r.uri)).toEqual([uri]);
        expect(h.service.getDecoration(file("/w/deep"), true)?.badge).toBe("●");

        h.peer.notify("window.fileDecorationsChanged", { handle: 1, uris: null });
        await settle();
        expect(h.service.getDecoration(file("/w/deep"), true)).toBeUndefined();
    });

    it("a change of an unknown handle and a malformed message change nothing", async () => {
        const h = setup();
        h.register();
        await settle();
        h.peer.notify("window.fileDecorationsChanged", { handle: 9, uris: [file("/w/a").toString()] });
        h.peer.notify("window.fileDecorationsChanged", { uris: [file("/w/a").toString()] } as never);
        h.peer.notify("window.registerFileDecorationProvider", { handle: "x" } as never);
        await settle();
        expect(h.batches).toEqual([]);
    });

    it("unregistering removes the provider's decorations", async () => {
        const h = setup();
        h.register();
        await settle();
        h.table.set(file("/w/a").toString(), { badge: "A" });
        h.service.getDecoration(file("/w/a"), false);
        await settle();
        h.peer.notify("window.unregisterFileDecorationProvider", { handle: 1 });
        await settle();
        expect(h.service.getDecoration(file("/w/a"), false)).toBeUndefined();
        expect(h.batches).toHaveLength(1);
    });

    it("re-registering a handle replaces the old registration", async () => {
        const h = setup();
        h.register(1);
        h.register(1);
        await settle();
        h.service.getDecoration(file("/w/a"), false);
        await settle();
        expect(h.batches).toHaveLength(1);
    });

    it("the spawn's death takes its providers and their decorations off", async () => {
        const h = setup();
        h.register();
        await settle();
        h.table.set(file("/w/a").toString(), { badge: "A", propagate: true });
        h.service.getDecoration(file("/w/a"), false);
        await settle();
        expect(h.service.getDecoration(file("/w"), true)?.badge).toBe("●");

        h.attached.dispose();
        await settle();
        expect(h.service.getDecoration(file("/w/a"), false)).toBeUndefined();
        expect(h.service.getDecoration(file("/w"), true)).toBeUndefined();
    });

    it("a failed batch leaves no cache: the next draw asks again", async () => {
        const h = setup();
        h.register();
        await settle();
        h.fail();
        h.service.getDecoration(file("/w/a"), false);
        await settle();
        h.service.getDecoration(file("/w/a"), false);
        await settle();
        expect(h.batches).toHaveLength(2);
    });

    it("a request cancelled before its batch leaves is not sent", async () => {
        const h = setup();
        h.register();
        await settle();
        h.service.getDecoration(file("/w/a"), false);
        // The event refetches the same resource in the same tick: the first ask is cancelled.
        h.peer.notify("window.fileDecorationsChanged", { handle: 1, uris: [file("/w/a").toString()] });
        await settle();
        expect(h.batches.flatMap((batch) => batch.requests.map((r) => r.uri))).toEqual([file("/w/a").toString()]);
    });

    it("without a service the provider's messages are accepted and nobody is asked", async () => {
        const customer = new FileDecorationsCustomer(undefined);
        const [a, b] = createInProcessChannelPair();
        const peer: SubprocessRpc = new RpcEndpoint(b);
        const asked = vi.fn(() => ({}));
        peer.handleRequest("window.provideFileDecorations", asked);
        const attached = customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
        peer.notify("window.registerFileDecorationProvider", { handle: 1, extensionId: "ext.id" });
        await settle();
        expect(asked).not.toHaveBeenCalled();
        attached.dispose();
    });
});
