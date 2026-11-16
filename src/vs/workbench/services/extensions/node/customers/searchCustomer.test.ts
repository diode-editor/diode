import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../../TestUtils/TempWorkspace.ts";
import { DisposableStore } from "../../../../../base/common/lifecycle.ts";
import type { HostRpc, SubprocessRpc } from "../../../../api/common/extHostProtocol.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";
import { registerExtHostFileSearch } from "../../../../api/node/extHostFileSearch.ts";
import type { IFileIndexRequest } from "../../../search/common/fileSearch.ts";
import { FileSearchEngine } from "../../../search/node/fileSearchEngine.ts";

import { SearchCustomer } from "./searchCustomer.ts";

describe("SearchCustomer ↔ extHostFileSearch over RPC", () => {
    let ws: ITempWorkspace;
    let store: DisposableStore;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-search-customer-" });
        store = new DisposableStore();
    });

    afterEach(() => {
        store.dispose();
        ws.dispose();
    });

    function request(cacheKey = "k"): IFileIndexRequest {
        return {
            cacheKey,
            folder: ws.dir,
            excludes: [],
            useIgnoreFiles: { local: true, parent: false, global: false },
        };
    }

    /** The subprocess side runs a real engine; `spawns` counts how often the customer asked for the subprocess. */
    function setup(engine = new FileSearchEngine()) {
        const [a, b] = createInProcessChannelPair();
        const hostRpc = new RpcEndpoint(a) as unknown as HostRpc;
        const subRpc = new RpcEndpoint(b) as unknown as SubprocessRpc;
        store.add(registerExtHostFileSearch(subRpc, engine));
        let spawns = 0;
        const customer = store.add(
            new SearchCustomer(() => {
                spawns++;
                return Promise.resolve(hostRpc);
            }),
        );
        const attachment = store.add(customer.attach({ rpc: hostRpc, logger: undefined }));
        return { customer, engine, attachment, spawns: () => spawns };
    }

    it("indexes in the subprocess and returns only the matches the core asked for", async () => {
        ws.writeFile("src/main.ts", "");
        ws.writeFile("src/other.ts", "");
        const { customer } = setup();

        expect(await customer.index(request())).toEqual({ limitHit: false });
        const result = await customer.query({ cacheKey: "k", query: "main", maxResults: 1 });

        expect(result.complete).toBe(true);
        expect(result.matches.map((m) => m.relativePath)).toEqual(["src/main.ts"]);
    });

    it("every request goes through ensureSubprocess: Quick Open starts the host when it is not up", async () => {
        const { customer, spawns } = setup();
        await customer.index(request());
        await customer.query({ cacheKey: "k", query: "", maxResults: 1 });
        expect(spawns()).toBe(2);
    });

    it("index growth arrives as onDidChangeIndex with the key", async () => {
        ws.writeFile("a.ts", "");
        const { customer } = setup();
        const keys: string[] = [];
        customer.onDidChangeIndex((key) => keys.push(key));

        await customer.index(request());

        await vi.waitFor(() => {
            expect(keys).toContain("k");
        });
    });

    it("clearCache reaches the engine", async () => {
        ws.writeFile("a.ts", "");
        const { customer, engine } = setup();
        await customer.index(request());
        const cleared = vi.spyOn(engine, "clearCache");

        customer.clearCache("k");

        await vi.waitFor(() => {
            expect(cleared).toHaveBeenCalledWith("k");
        });
        expect((await customer.query({ cacheKey: "k", query: "", maxResults: 5 })).matches).toEqual([]);
    });

    it("after the spawn ends, notifications stop and clearCache has nobody to tell", async () => {
        ws.writeFile("a.ts", "");
        const { customer, attachment, engine } = setup();
        const keys: string[] = [];
        customer.onDidChangeIndex((key) => keys.push(key));
        const cleared = vi.spyOn(engine, "clearCache");
        attachment.dispose();

        customer.clearCache("k");
        await engine.index(request());

        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(keys).toEqual([]);
        expect(cleared).not.toHaveBeenCalled();
    });

    it("disposing the registration disposes the engine: its walks die with it", () => {
        const engine = new FileSearchEngine();
        const disposed = vi.spyOn(engine, "dispose");
        const [, b] = createInProcessChannelPair();
        const registration = registerExtHostFileSearch(new RpcEndpoint(b) as unknown as SubprocessRpc, engine);

        registration.dispose();

        expect(disposed).toHaveBeenCalledTimes(1);
    });

    it("a request rejects when the subprocess cannot be started", async () => {
        const customer = store.add(new SearchCustomer(() => Promise.reject(new Error("ExtensionHost disposed"))));
        await expect(customer.index(request())).rejects.toThrow("ExtensionHost disposed");
        await expect(customer.query({ cacheKey: "k", query: "", maxResults: 1 })).rejects.toThrow();
    });
});
