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

/** Реестр команд ядра, который помнит каждую регистрацию прокси. */
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

describe("CommandsCustomer — прокси команд субпроцесса", () => {
    it("регистрация заводит прокси с подписью палитры; исполнение уходит в субпроцесс", async () => {
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

    it("повторная регистрация заменяет прокси, снятие — снимает; мусорный id игнорируется", async () => {
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

    it("уход спавна снимает все его прокси", async () => {
        const h = setup();
        const attached = h.attachTo();
        h.peer.notify("commands.registerCommand", { id: "a" });
        h.peer.notify("commands.registerCommand", { id: "b" });
        await flushMicrotasks();

        attached.dispose();

        expect(h.commands.proxies.every((p) => p.disposed)).toBe(true);
    });

    it("команда ядра по просьбе субпроцесса исполняется с аргументами; мусор — отказ", async () => {
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

describe("CommandsCustomer — заглушки-активаторы onCommand", () => {
    it("заглушка поднимает расширение и исполняет уже настоящую команду", async () => {
        const events: string[] = [];
        const h = setup((event) => {
            events.push(event);
            // Расширение во время активации регистрирует команду.
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
        // Настоящий прокси сменил заглушку.
        expect(stub.disposed).toBe(true);
    });

    it("активация упала — ошибка в лог, команда отвечает undefined", async () => {
        const h = setup(() => Promise.reject(new Error("boom")));
        h.customer.arm("ext.run");

        await expect(h.commands.live("ext.run")[0].invoke([])).resolves.toBeUndefined();
        expect(h.log.error).toHaveBeenCalledWith(
            'failed to activate extension for command "ext.run"',
            expect.any(Error),
        );
        expect(h.commands.service.execute).not.toHaveBeenCalled();
    });

    it("расширение поднялось, но команду не завело — предупреждение, без петли", async () => {
        const h = setup();
        h.attachTo();
        h.customer.arm("ext.run");

        await expect(h.commands.live("ext.run")[0].invoke([])).resolves.toBeUndefined();
        expect(h.log.warn).toHaveBeenCalledWith('command "ext.run" is still unregistered after activation');
        expect(h.commands.service.execute).not.toHaveBeenCalled();
    });

    it("активация «прошла», а спавна нет (субпроцесс ушёл) — предупреждение вместо падения", async () => {
        const h = setup();
        h.customer.arm("ext.run");

        await expect(h.commands.live("ext.run")[0].invoke([])).resolves.toBeUndefined();
        expect(h.log.warn).toHaveBeenCalledWith('command "ext.run" is still unregistered after activation');
    });

    it("заглушка не ставится поверх живого прокси и второй раз; disarm и disarmAll снимают", async () => {
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
