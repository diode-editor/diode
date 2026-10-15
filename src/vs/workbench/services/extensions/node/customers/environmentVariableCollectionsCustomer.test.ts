import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import { parseWireSetEnvironmentVariableCollection } from "../hostWireParsers.ts";

import {
    createInMemoryEnvironmentVariableCollectionStore,
    EnvironmentVariableCollectionsCustomer,
} from "./environmentVariableCollectionsCustomer.ts";

const MUTATOR = { variable: "P", value: "1", type: 1, options: { applyAtProcessCreation: true } };

function setup() {
    const store = createInMemoryEnvironmentVariableCollectionStore();
    const customer = new EnvironmentVariableCollectionsCustomer(store);
    const [a, b] = createInProcessChannelPair();
    const peer = new RpcEndpoint(b);
    const spawn = customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
    return { store, customer, peer, spawn };
}

describe("EnvironmentVariableCollectionsCustomer", () => {
    it("коллекция субпроцесса — в хранилище с persistent и описаниями", async () => {
        const { store, peer } = setup();
        peer.notify("terminal.setEnvironmentVariableCollection", {
            extensionId: "a.b",
            persistent: false,
            collection: [["P", MUTATOR]],
            description: [["", { description: "d" }]],
        });
        await flushMicrotasks();
        const stored = store.collections.get("a.b");
        expect(stored?.persistent).toBe(false);
        expect([...(stored?.map ?? [])]).toEqual([["P", MUTATOR]]);
        expect([...(stored?.descriptionMap ?? [])]).toEqual([["", { description: "d", scope: undefined }]]);
    });

    it("опустевшая коллекция снимается из хранилища", async () => {
        const { store, peer } = setup();
        peer.notify("terminal.setEnvironmentVariableCollection", {
            extensionId: "a.b",
            persistent: true,
            collection: [["P", MUTATOR]],
            description: [],
        });
        peer.notify("terminal.setEnvironmentVariableCollection", {
            extensionId: "a.b",
            persistent: true,
            description: [],
        });
        await flushMicrotasks();
        expect(store.collections.has("a.b")).toBe(false);
    });

    it("структурно чужое — игнорируется", async () => {
        const { store, peer } = setup();
        peer.notify("terminal.setEnvironmentVariableCollection", { persistent: true, collection: [["P", MUTATOR]] });
        await flushMicrotasks();
        expect(store.collections.size).toBe(0);
    });

    it("семя: всё хранилище субпроцессу (только мутаторы); пустое — семени нет", async () => {
        const { store, customer, peer } = setup();
        const seeds = vi.fn();
        peer.handleNotification("terminal.initEnvironmentVariableCollections", seeds);
        customer.pushInitialState();
        await flushMicrotasks();
        expect(seeds).not.toHaveBeenCalled();
        store.set("a.b", {
            persistent: false,
            map: new Map([["P", { ...MUTATOR, type: 1 as const }]]),
            descriptionMap: new Map([["", { description: "d", scope: undefined }]]),
        });
        customer.pushInitialState();
        await flushMicrotasks();
        expect(seeds).toHaveBeenCalledExactlyOnceWith({ collections: [["a.b", [["P", MUTATOR]]]] });
    });

    it("без спавна (до attach и после смерти) семени нет", async () => {
        const store = createInMemoryEnvironmentVariableCollectionStore();
        store.set("a.b", { persistent: true, map: new Map([["P", { ...MUTATOR, type: 1 as const }]]) });
        const customer = new EnvironmentVariableCollectionsCustomer(store);
        expect(() => {
            customer.pushInitialState();
        }).not.toThrow();
        const [a, b] = createInProcessChannelPair();
        const peer = new RpcEndpoint(b);
        const seeds = vi.fn();
        peer.handleNotification("terminal.initEnvironmentVariableCollections", seeds);
        customer.attach({ rpc: new RpcEndpoint(a), logger: undefined }).dispose();
        customer.pushInitialState();
        await flushMicrotasks();
        expect(seeds).not.toHaveBeenCalled();
    });

    it("хранилище в памяти: set/delete", () => {
        const store = createInMemoryEnvironmentVariableCollectionStore();
        store.set("a.b", { persistent: true, map: new Map() });
        expect(store.collections.has("a.b")).toBe(true);
        store.delete("a.b");
        expect(store.collections.has("a.b")).toBe(false);
    });
});

describe("parseWireSetEnvironmentVariableCollection", () => {
    it("persistent по умолчанию true, false — только явный", () => {
        expect(parseWireSetEnvironmentVariableCollection({ extensionId: "a.b" })).toEqual({
            extensionId: "a.b",
            persistent: true,
            collection: [],
            description: [],
        });
        expect(parseWireSetEnvironmentVariableCollection({ extensionId: "a.b", persistent: false })?.persistent).toBe(
            false,
        );
    });

    it.each([null, "x", {}, { extensionId: "" }, { extensionId: 1 }])("без id — null (%j)", (raw) => {
        expect(parseWireSetEnvironmentVariableCollection(raw)).toBeNull();
    });
});
