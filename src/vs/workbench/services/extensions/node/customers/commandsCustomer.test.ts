import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../../TestUtils/timing.ts";
import { renderCodicons } from "../../../../../base/common/codicons.ts";
import type { IDisposable } from "../../../../../base/common/lifecycle.ts";
import type { ICommandService } from "../../../../api/common/iCommandService.ts";
import { createInProcessChannelPair } from "../../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../../api/common/rpcEndpoint.ts";

import { CommandsCustomer } from "./commandsCustomer.ts";

interface IProxyRecord {
    readonly id: string;
    readonly invoke: (args: readonly unknown[]) => unknown;
    readonly title: string | undefined;
    readonly category: string | undefined;
    disposed: boolean;
}

function fakeCommands() {
    const proxies: IProxyRecord[] = [];
    const service = {
        execute: vi.fn((id: string, args: readonly unknown[]) => `ran ${id} ${JSON.stringify(args)}`),
        registerProxy: (
            id: string,
            invoke: (args: readonly unknown[]) => unknown,
            title?: string,
            category?: string,
        ): IDisposable => {
            const record: IProxyRecord = { id, invoke, title, category, disposed: false };
            proxies.push(record);
            return {
                dispose: () => {
                    record.disposed = true;
                },
            };
        },
    } as unknown as ICommandService & { execute: ReturnType<typeof vi.fn> };
    const live = (id: string) => proxies.filter((p) => p.id === id && !p.disposed);
    return { service, proxies, live };
}

function logger() {
    return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), isEnabled: () => true };
}

function setup(activate: (event: string) => Promise<void> = () => Promise.resolve()) {
    const commands = fakeCommands();
    const log = logger();
    const customer = new CommandsCustomer(commands.service, activate, log);
    const [a, b] = createInProcessChannelPair();
    const peer = new RpcEndpoint(b);
    const attachTo = () => customer.attach({ rpc: new RpcEndpoint(a), logger: undefined });
    return { customer, commands, log, peer, attachTo };
}

describe("CommandsCustomer — subprocess command proxies", () => {
    it("registration creates a proxy with a palette label; execution goes to the subprocess", async () => {
        const h = setup();
        h.customer.addPaletteMetadata({
            commandTitles: { "ext.run": "$(play) Run" },
            commandCategories: { "ext.run": "Ext" },
        });
        h.attachTo();
        h.peer.handleRequest("commands.executeCommand", (params) => params);

        h.peer.notify("commands.registerCommand", { id: "ext.run" });
        await flushMicrotasks();

        const [proxy] = h.commands.live("ext.run");
        expect(proxy).toMatchObject({ title: renderCodicons("$(play) Run"), category: "Ext" });
        expect(proxy.title).not.toContain("$(");
        await expect(proxy.invoke([1, 2])).resolves.toEqual({ id: "ext.run", args: [1, 2] });
    });

    it("re-registration replaces the proxy, unregister removes it; a junk id is ignored", async () => {
        const h = setup();
        h.attachTo();

        h.peer.notify("commands.registerCommand", { id: "ext.run" });
        h.peer.notify("commands.registerCommand", { id: "ext.run" });
        h.peer.notify("commands.registerCommand", { id: "" });
        h.peer.notify("commands.registerCommand", null);
        await flushMicrotasks();
        expect(h.commands.proxies.map((p) => p.disposed)).toEqual([true, false]);

        h.peer.notify("commands.unregisterCommand", { id: 7 });
        h.peer.notify("commands.unregisterCommand", { id: "ext.run" });
        await flushMicrotasks();
        expect(h.commands.live("ext.run")).toEqual([]);
    });

    it("spawn exit removes all its proxies", async () => {
        const h = setup();
        const attached = h.attachTo();
        h.peer.notify("commands.registerCommand", { id: "a" });
        h.peer.notify("commands.registerCommand", { id: "b" });
        await flushMicrotasks();

        attached.dispose();

        expect(h.commands.proxies.every((p) => p.disposed)).toBe(true);
    });

    it("a core command requested by the subprocess runs with arguments; junk — rejected", async () => {
        const h = setup();
        h.attachTo();

        await expect(h.peer.request("commands.executeCommand", { id: "core.cmd", args: ["x"] })).resolves.toBe(
            'ran core.cmd ["x"]',
        );
        await expect(h.peer.request("commands.executeCommand", { id: "core.cmd" })).resolves.toBe("ran core.cmd []");
        await expect(h.peer.request("commands.executeCommand", null)).rejects.toThrow("params must be an object");
        await expect(h.peer.request("commands.executeCommand", { id: 7 })).rejects.toThrow(
            "id must be a non-empty string",
        );
        await expect(h.peer.request("commands.executeCommand", { id: "" })).rejects.toThrow(
            "id must be a non-empty string",
        );
    });
});

describe("CommandsCustomer — onCommand activator stubs", () => {
    it("the stub activates the extension and runs the real command", async () => {
        const events: string[] = [];
        const h = setup((event) => {
            events.push(event);
            h.peer.notify("commands.registerCommand", { id: "ext.run" });
            return flushMicrotasks();
        });
        h.customer.addPaletteMetadata({ commandTitles: { "ext.run": "Run" } });
        h.attachTo();
        h.customer.arm("ext.run");
        const [stub] = h.commands.live("ext.run");
        expect(stub.title).toBe("Run");

        await expect(stub.invoke(["a"])).resolves.toBe('ran ext.run ["a"]');
        expect(events).toEqual(["onCommand:ext.run"]);
        // The real proxy replaced the stub.
        expect(stub.disposed).toBe(true);
    });

    it("activation failed — error logged, the command returns undefined", async () => {
        const h = setup(() => Promise.reject(new Error("boom")));
        h.customer.arm("ext.run");

        await expect(h.commands.live("ext.run")[0].invoke([])).resolves.toBeUndefined();
        expect(h.log.error).toHaveBeenCalledWith(
            'failed to activate extension for command "ext.run"',
            expect.any(Error),
        );
        expect(h.commands.service.execute).not.toHaveBeenCalled();
    });

    it("extension activated but did not register the command — warning, no loop", async () => {
        const h = setup();
        h.attachTo();
        h.customer.arm("ext.run");

        await expect(h.commands.live("ext.run")[0].invoke([])).resolves.toBeUndefined();
        expect(h.log.warn).toHaveBeenCalledWith('command "ext.run" is still unregistered after activation');
        expect(h.commands.service.execute).not.toHaveBeenCalled();
    });

    it("activation "succeeded" but there is no spawn (subprocess gone) — a warning instead of a crash", async () => {
        const h = setup();
        h.customer.arm("ext.run");

        await expect(h.commands.live("ext.run")[0].invoke([])).resolves.toBeUndefined();
        expect(h.log.warn).toHaveBeenCalledWith('command "ext.run" is still unregistered after activation');
    });

    it("a stub is not installed over a live proxy or twice; disarm and disarmAll remove it", async () => {
        const h = setup();
        h.attachTo();
        h.peer.notify("commands.registerCommand", { id: "live" });
        await flushMicrotasks();

        h.customer.arm("live");
        h.customer.arm("a");
        h.customer.arm("a");
        h.customer.arm("b");
        expect(h.commands.proxies.map((p) => p.id)).toEqual(["live", "a", "b"]);

        h.customer.disarm("a");
        expect(h.commands.live("a")).toEqual([]);
        h.customer.disarmAll();
        expect(h.commands.live("b")).toEqual([]);
        expect(h.commands.live("live")).toHaveLength(1);
    });
});
