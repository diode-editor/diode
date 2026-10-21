import { afterEach, describe, expect, it, vi } from "vitest";

import { CommandRegistry } from "../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../platform/contextkey/common/contextKeyService.ts";

import {
    DEFAULT_COMMAND_TIMEOUT_MS,
    DEFAULT_READY_TIMEOUT_MS,
    DiodeInspectorMethod,
    type IDiodeInspectorPorts,
    registerDiodeInspectorMethods,
    toWire,
} from "./diodeInspectorMethods.ts";

type Handler = (params: unknown) => unknown;

function setup(overrides: Partial<IDiodeInspectorPorts> = {}): {
    call: (method: string, params?: unknown) => Promise<unknown>;
    commands: CommandRegistry;
    contextKeys: ContextKeyService;
    methods: Map<string, Handler>;
} {
    const methods = new Map<string, Handler>();
    const commands = new CommandRegistry();
    const contextKeys = new ContextKeyService();
    const entries: Record<string, string> = { bootstrap: "boot line\n", "ext.channel": "from extension\n" };
    const ports: IDiodeInspectorPorts = {
        commands,
        contextKeys,
        output: {
            getChannels: () => [
                { id: "bootstrap", label: "Bootstrap" },
                { id: "ext.channel", label: "My Extension" },
            ],
            renderChannel: (id) => entries[id] ?? "",
        },
        ready: Promise.resolve(),
        pid: 4242,
        ...overrides,
    };
    registerDiodeInspectorMethods((method, handler) => {
        methods.set(method, handler);
    }, ports);
    const call = async (method: string, params?: unknown): Promise<unknown> => {
        const handler = methods.get(method);
        if (handler === undefined) throw new Error(`not registered: ${method}`);
        return handler(params);
    };
    return { call, commands, contextKeys, methods };
}

afterEach(() => {
    vi.useRealTimers();
});

describe("registerDiodeInspectorMethods", () => {
    it("registers all Diode.* methods and nothing else", () => {
        const { methods } = setup();
        expect([...methods.keys()].sort()).toEqual(Object.values(DiodeInspectorMethod).sort());
        for (const name of methods.keys()) expect(name.startsWith("Diode.")).toBe(true);
    });

    describe("whenReady", () => {
        it("ready — ready:true", async () => {
            const { call } = setup();
            await expect(call(DiodeInspectorMethod.whenReady, {})).resolves.toEqual({ ready: true, pid: 4242 });
        });

        it("not ready within timeoutMs — ready:false, not an endless wait", async () => {
            const { call } = setup({ ready: new Promise<void>(() => undefined) });
            await expect(call(DiodeInspectorMethod.whenReady, { timeoutMs: 5 })).resolves.toEqual({
                ready: false,
                pid: 4242,
            });
        });

        it("no params — default timeout, readiness is still visible", async () => {
            const { call } = setup();
            await expect(call(DiodeInspectorMethod.whenReady)).resolves.toEqual({ ready: true, pid: 4242 });
            expect(DEFAULT_READY_TIMEOUT_MS).toBe(60_000);
        });

        it("invalid timeoutMs — protocol error", async () => {
            const { call } = setup();
            await expect(call(DiodeInspectorMethod.whenReady, { timeoutMs: "1" })).rejects.toThrow(
                "'timeoutMs' must be a non-negative number",
            );
            await expect(call(DiodeInspectorMethod.whenReady, { timeoutMs: -1 })).rejects.toThrow("non-negative");
            await expect(call(DiodeInspectorMethod.whenReady, { timeoutMs: Number.NaN })).rejects.toThrow(
                "non-negative",
            );
            await expect(call(DiodeInspectorMethod.whenReady, { timeoutMs: Infinity })).rejects.toThrow("non-negative");
        });

        it("wait timer is cleared as soon as readiness arrives (does not hold the process)", async () => {
            vi.useFakeTimers();
            const { call } = setup();
            await call(DiodeInspectorMethod.whenReady, { timeoutMs: 60_000 });
            expect(vi.getTimerCount()).toBe(0);
        });

        it("timeoutMs: 0 is allowed (instant readiness probe)", async () => {
            const { call } = setup({ ready: new Promise<void>(() => undefined) });
            await expect(call(DiodeInspectorMethod.whenReady, { timeoutMs: 0 })).resolves.toEqual({
                ready: false,
                pid: 4242,
            });
        });
    });

    describe("executeCommand", () => {
        it("executes the command with arguments and returns its result", async () => {
            const { call, commands } = setup();
            const seen: unknown[][] = [];
            commands.register("test.sum", (...args) => {
                seen.push(args);
                return (args[0] as number) + (args[1] as number);
            });
            await expect(call(DiodeInspectorMethod.executeCommand, { id: "test.sum", args: [2, 3] })).resolves.toEqual({
                settled: true,
                result: 5,
            });
            expect(seen).toEqual([[2, 3]]);
        });

        it("no args — command is called without arguments; undefined result → null", async () => {
            const { call, commands } = setup();
            const seen: unknown[][] = [];
            commands.register("test.noop", (...args) => {
                seen.push(args);
            });
            await expect(call(DiodeInspectorMethod.executeCommand, { id: "test.noop" })).resolves.toEqual({
                settled: true,
                result: null,
            });
            expect(seen).toEqual([[]]);
        });

        it("awaits the command's promise", async () => {
            const { call, commands } = setup();
            commands.register("test.async", () => Promise.resolve({ ok: 1 }));
            await expect(call(DiodeInspectorMethod.executeCommand, { id: "test.async" })).resolves.toEqual({
                settled: true,
                result: { ok: 1 },
            });
        });

        it("promise not settled within timeoutMs — settled:false (a dialog awaits the next input)", async () => {
            const { call, commands } = setup();
            commands.register("test.dialog", () => new Promise(() => undefined));
            await expect(
                call(DiodeInspectorMethod.executeCommand, { id: "test.dialog", timeoutMs: 5 }),
            ).resolves.toEqual({
                settled: false,
            });
            expect(DEFAULT_COMMAND_TIMEOUT_MS).toBe(10_000);
        });

        it("command rejection — protocol error", async () => {
            const { call, commands } = setup();
            commands.register("test.fail", () => Promise.reject(new Error("boom")));
            await expect(call(DiodeInspectorMethod.executeCommand, { id: "test.fail" })).rejects.toThrow("boom");
        });

        it("unknown command — error, not a silent undefined", async () => {
            const { call } = setup();
            await expect(call(DiodeInspectorMethod.executeCommand, { id: "no.such" })).rejects.toThrow(
                "unknown command: no.such",
            );
        });

        it("invalid params — protocol error", async () => {
            const { call } = setup();
            await expect(call(DiodeInspectorMethod.executeCommand, {})).rejects.toThrow(
                "'id' must be a non-empty string",
            );
            await expect(call(DiodeInspectorMethod.executeCommand, { id: "" })).rejects.toThrow("'id'");
            await expect(call(DiodeInspectorMethod.executeCommand, null)).rejects.toThrow(
                "'id' must be a non-empty string",
            );
            await expect(call(DiodeInspectorMethod.executeCommand, "x")).rejects.toThrow("'id'");
            await expect(call(DiodeInspectorMethod.executeCommand, { id: "a", args: "x" })).rejects.toThrow(
                "'args' must be an array",
            );
        });
    });

    it("listCommands — commands with a title", async () => {
        const { call, commands } = setup();
        commands.register("test.titled", () => undefined, "Titled");
        commands.register("test.hidden", () => undefined);
        const { commands: list } = (await call(DiodeInspectorMethod.listCommands)) as {
            commands: { id: string; title: string }[];
        };
        expect(list.map((c) => [c.id, c.title])).toEqual([["test.titled", "Titled"]]);
    });

    it("listOutputChannels — id and label", async () => {
        const { call } = setup();
        await expect(call(DiodeInspectorMethod.listOutputChannels)).resolves.toEqual({
            channels: [
                { id: "bootstrap", label: "Bootstrap" },
                { id: "ext.channel", label: "My Extension" },
            ],
        });
    });

    describe("getOutput", () => {
        it("by id", async () => {
            const { call } = setup();
            await expect(call(DiodeInspectorMethod.getOutput, { channel: "bootstrap" })).resolves.toEqual({
                id: "bootstrap",
                label: "Bootstrap",
                text: "boot line\n",
            });
        });

        it("by label, case-insensitive", async () => {
            const { call } = setup();
            await expect(call(DiodeInspectorMethod.getOutput, { channel: "my extension" })).resolves.toEqual({
                id: "ext.channel",
                label: "My Extension",
                text: "from extension\n",
            });
        });

        it("id takes precedence over label", async () => {
            const { call } = setup({
                output: {
                    getChannels: () => [
                        { id: "a", label: "b" },
                        { id: "b", label: "B channel" },
                    ],
                    renderChannel: (id) => `text of ${id}`,
                },
            });
            await expect(call(DiodeInspectorMethod.getOutput, { channel: "b" })).resolves.toMatchObject({ id: "b" });
        });

        it("unknown channel — error listing the known ones", async () => {
            const { call } = setup();
            await expect(call(DiodeInspectorMethod.getOutput, { channel: "nope" })).rejects.toThrow(
                "unknown output channel: nope; known: bootstrap (Bootstrap), ext.channel (My Extension)",
            );
        });
    });

    it("getContextKey — raw value; unset → null", async () => {
        const { call, contextKeys } = setup();
        contextKeys.setRaw("ext.flag", ["x"]);
        await expect(call(DiodeInspectorMethod.getContextKey, { key: "ext.flag" })).resolves.toEqual({ value: ["x"] });
        await expect(call(DiodeInspectorMethod.getContextKey, { key: "unset" })).resolves.toEqual({ value: null });
    });

    it("evaluateWhen — when expression over current keys", async () => {
        const { call, contextKeys } = setup();
        contextKeys.set("textInputFocus", true);
        await expect(
            call(DiodeInspectorMethod.evaluateWhen, { expr: "textInputFocus && !listFocus" }),
        ).resolves.toEqual({
            value: true,
        });
        await expect(call(DiodeInspectorMethod.evaluateWhen, { expr: "listFocus" })).resolves.toEqual({ value: false });
    });
});

describe("toWire", () => {
    it("JSON values — as is (copied)", () => {
        const value = { a: [1, "x", true, null] };
        const wired = toWire(value);
        expect(wired).toEqual(value);
        expect(wired).not.toBe(value);
    });

    it("undefined → null (otherwise the field would vanish from the response)", () => {
        expect(toWire(undefined)).toBeNull();
    });

    it("unserializable (cycle) → string, not an exception on send", () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expect(toWire(cyclic)).toBe("<unserializable: object>");
        expect(toWire(10n)).toBe("10");
    });
});
