import { describe, expect, it } from "vitest";

import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { ILogService, ILogSink, LogEntry } from "../../../../platform/log/common/iLogService.ts";
import { LogLevel } from "../../../../platform/log/common/logLevel.ts";
import { LogService } from "../../../../platform/log/common/logService.ts";
import { RingBufferSink } from "../../../../platform/log/common/ringBufferSink.ts";

import { OutputChannelRegistry } from "./outputChannelRegistry.ts";
import { formatOutputLine, OutputService } from "./outputService.ts";

/** Real LogService + RingBufferSink: their wiring is what the test is about. */
function createStack() {
    const logService = new LogService();
    const history = new RingBufferSink();
    logService.addSink(history as ILogSink);
    const registry = new OutputChannelRegistry();
    const contextKeys = new ContextKeyService();
    return { logService, history, registry, contextKeys };
}

function createService(stack: ReturnType<typeof createStack>): OutputService {
    return new OutputService(stack.history, stack.logService as ILogService, stack.registry, stack.contextKeys);
}

function entry(overrides: Partial<LogEntry> = {}): LogEntry {
    return {
        timestamp: Date.UTC(2026, 0, 1, 12, 4, 31, 220),
        channel: "bootstrap",
        level: LogLevel.Info,
        message: "diode starting",
        args: [],
        ...overrides,
    };
}

describe("formatOutputLine", () => {
    it("puts the level in brackets to suit the stock log grammar", () => {
        // The extensions/log grammar highlights exactly `[info]`/`[warn]`/`[error]`,
        // so the bracket form is part of the contract, not cosmetics.
        const line = formatOutputLine(entry({ level: LogLevel.Warn, message: "activationEvents empty" }));
        expect(line).toContain("[warn] activationEvents empty");
    });

    it("prints the time as HH:MM:SS.mmm", () => {
        const timestamp = Date.UTC(2026, 0, 1, 12, 4, 31, 220);
        const d = new Date(timestamp);
        const pad = (n: number, w = 2) => String(n).padStart(w, "0");
        // The expectation is built from the same Date fields: the test is about FORMAT, not
        // the time zone of the machine it runs on.
        const expected = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
        expect(formatOutputLine(entry({ timestamp })).slice(0, expected.length)).toBe(expected);
        expect(expected).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
    });

    it("appends args as JSON", () => {
        const line = formatOutputLine(entry({ message: "activate failed", args: [{ id: "git" }] }));
        expect(line).toContain('activate failed {"id":"git"}');
    });

    it("prints an error in args by its message, not as JSON", () => {
        // `Error` fields are non-enumerable, so JSON would give `{}`; one received over RPC
        // has own fields, and JSON would give the internal `{"name":…,"message":…}`.
        const native = new Error("boom");
        const wired = Object.assign(new Error(), { name: "Error", message: "from rpc" });
        const line = formatOutputLine(entry({ message: "failed", args: [native, wired] }));
        expect(line).toMatch(/failed boom from rpc$/);
    });

    it("a non-serializable argument does not break formatting", () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expect(() => formatOutputLine(entry({ args: [cyclic] }))).not.toThrow();
    });

    it("undefined in args does not turn into nothing", () => {
        // JSON.stringify(undefined) === undefined: without the fallback the line would
        // silently lose the argument.
        expect(formatOutputLine(entry({ args: [undefined] }))).toContain("undefined");
    });
});

describe("OutputService: channels", () => {
    it("picks up channels that wrote before the service started", () => {
        const stack = createStack();
        stack.logService.createLogger("bootstrap").info("early");

        const service = createService(stack);

        expect(service.getChannels().map((c) => c.id)).toContain("bootstrap");
        service.dispose();
    });

    it("the first known channel becomes active", () => {
        const stack = createStack();
        stack.logService.createLogger("bootstrap").info("early");

        const service = createService(stack);

        expect(service.getActiveChannelId()).toBe("bootstrap");
        service.dispose();
    });

    it("a channel that appears in the live stream is auto-registered", () => {
        // Loggers are created ad hoc: without auto-registration the subsystem would be missing
        // from the selector and its log unreachable.
        const stack = createStack();
        const service = createService(stack);
        expect(service.getChannels()).toHaveLength(0);

        stack.logService.createLogger("files.watcher").info("watching");

        expect(service.getChannels().map((c) => c.id)).toEqual(["files.watcher"]);
        service.dispose();
    });

    it("a declared label is not overwritten by auto-registration", () => {
        const stack = createStack();
        stack.registry.registerChannel({ id: "extensions.host", label: "Extension Host" });
        const service = createService(stack);

        stack.logService.createLogger("extensions.host").info("started");

        expect(service.getChannels()).toEqual([{ id: "extensions.host", label: "Extension Host" }]);
        service.dispose();
    });

    it("the channel label comes from its creator: labeled channels are visible before the first write, in creation order", () => {
        const stack = createStack();
        stack.logService.createLogger("bootstrap", { label: "Bootstrap" });
        stack.logService.createLogger("configuration", { label: "Configuration" });

        const service = createService(stack);

        expect(service.getChannels()).toEqual([
            { id: "bootstrap", label: "Bootstrap" },
            { id: "configuration", label: "Configuration" },
        ]);
        expect(service.getActiveChannelId()).toBe("bootstrap");
        service.dispose();
    });

    it("a labeled channel created after the service starts enters the registry with its label", () => {
        const stack = createStack();
        const service = createService(stack);

        stack.logService.createLogger("extensions.host", { label: "Extension Host" }).info("started");

        expect(service.getChannels()).toEqual([{ id: "extensions.host", label: "Extension Host" }]);
        service.dispose();
        stack.logService.createLogger("late", { label: "Late" });
        expect(stack.registry.getChannel("late")).toBeUndefined();
    });

    it("a channel declared later becomes active if there was no active one", () => {
        const stack = createStack();
        const service = createService(stack);
        expect(service.getActiveChannelId()).toBeNull();

        stack.registry.registerChannel({ id: "later", label: "Later" });

        expect(service.getActiveChannelId()).toBe("later");
        service.dispose();
    });
});

describe("OutputService: active channel", () => {
    function serviceWithTwoChannels() {
        const stack = createStack();
        stack.logService.createLogger("bootstrap").info("boot");
        stack.logService.createLogger("configuration").info("config");
        return { stack, service: createService(stack) };
    }

    it("showChannel switches and fires the event", () => {
        const { service } = serviceWithTwoChannels();
        const seen: string[] = [];
        service.onDidChangeActiveChannel((id) => seen.push(id));

        service.showChannel("configuration");

        expect(service.getActiveChannelId()).toBe("configuration");
        expect(seen).toEqual(["configuration"]);
        service.dispose();
    });

    it("a repeated showChannel of the same channel does not fire", () => {
        const { service } = serviceWithTwoChannels();
        let fired = 0;
        service.onDidChangeActiveChannel(() => fired++);

        service.showChannel("bootstrap");

        expect(fired).toBe(0);
        service.dispose();
    });

    it("the activeOutputChannel context key is updated BEFORE the event is dispatched", () => {
        // Selector items' `toggled` hangs on this key. When a subscriber set the key,
        // it could run after whoever re-reads the items, and the selector
        // showed the previous channel while the content had already switched.
        const { stack, service } = serviceWithTwoChannels();
        let keyAtNotify: unknown;
        service.onDidChangeActiveChannel(() => {
            keyAtNotify = stack.contextKeys.get("activeOutputChannel");
        });

        service.showChannel("configuration");

        expect(keyAtNotify).toBe("configuration");
        service.dispose();
    });

    it("the key is set already at startup, from the first channel", () => {
        const { stack, service } = serviceWithTwoChannels();
        expect(stack.contextKeys.get("activeOutputChannel")).toBe("bootstrap");
        service.dispose();
    });

    it("without channels the key is empty, not undefined", () => {
        const stack = createStack();
        const service = createService(stack);
        expect(stack.contextKeys.get("activeOutputChannel")).toBe("");
        service.dispose();
    });

    it("an unknown channel is ignored", () => {
        const { service } = serviceWithTwoChannels();

        service.showChannel("nope");

        expect(service.getActiveChannelId()).toBe("bootstrap");
        service.dispose();
    });
});

describe("OutputService: content and live tail", () => {
    it("renderChannel returns the channel history line by line", () => {
        const stack = createStack();
        const logger = stack.logService.createLogger("bootstrap");
        logger.info("first");
        logger.warn("second");
        const service = createService(stack);

        const text = service.renderChannel("bootstrap");

        expect(text.split("\n").filter(Boolean)).toHaveLength(2);
        expect(text).toContain("[info] first");
        expect(text).toContain("[warn] second");
        expect(text.endsWith("\n")).toBe(true);
        service.dispose();
    });

    it("an empty channel renders as an empty string", () => {
        const stack = createStack();
        const service = createService(stack);
        expect(service.renderChannel("nope")).toBe("");
        service.dispose();
    });

    it("the tail comes only for the active channel", () => {
        const stack = createStack();
        stack.logService.createLogger("bootstrap").info("boot");
        stack.logService.createLogger("configuration").info("config");
        const service = createService(stack);
        const seen: string[] = [];
        service.onDidAppendToActiveChannel((e) => seen.push(e.message));

        stack.logService.createLogger("configuration").info("ignored");
        stack.logService.createLogger("bootstrap").info("tailed");

        expect(seen).toEqual(["tailed"]);
        service.dispose();
    });

    it("after the active channel changes, the tail comes from it", () => {
        const stack = createStack();
        stack.logService.createLogger("bootstrap").info("boot");
        stack.logService.createLogger("configuration").info("config");
        const service = createService(stack);
        const seen: string[] = [];
        service.onDidAppendToActiveChannel((e) => seen.push(e.message));

        service.showChannel("configuration");
        stack.logService.createLogger("configuration").info("now tailed");
        stack.logService.createLogger("bootstrap").info("now ignored");

        expect(seen).toEqual(["now tailed"]);
        service.dispose();
    });

    it("the subscription is removed on dispose", () => {
        const stack = createStack();
        stack.logService.createLogger("bootstrap").info("boot");
        const service = createService(stack);
        const seen: string[] = [];
        const sub = service.onDidAppendToActiveChannel((e) => seen.push(e.message));

        sub.dispose();
        stack.logService.createLogger("bootstrap").info("after");

        expect(seen).toEqual([]);
        service.dispose();
    });
});
