import { describe, expect, it, vi } from "vitest";

import type { ILogSink, LogEntry } from "./iLogService.ts";
import { LogLevel } from "./logLevel.ts";
import { LogService } from "./logService.ts";

function recordingSink(): ILogSink & { entries: LogEntry[] } {
    const entries: LogEntry[] = [];
    return {
        entries,
        append(entry): void {
            entries.push(entry);
        },
        dispose(): void {
            /* no-op */
        },
    };
}

describe("LogService — level filtering", () => {
    it("default level is trace (everything kept)", () => {
        const service = new LogService();
        const sink = recordingSink();
        service.addSink(sink);

        const logger = service.createLogger("test");
        logger.trace("trace msg");
        logger.debug("debug msg");
        logger.info("info msg");
        logger.error("error msg");

        expect(sink.entries.map((e) => e.message)).toEqual(["trace msg", "debug msg", "info msg", "error msg"]);
    });

    it("setLevel('*', Error) suppresses lower levels globally", () => {
        const service = new LogService();
        const sink = recordingSink();
        service.addSink(sink);
        service.setLevel("*", LogLevel.Error);

        const logger = service.createLogger("any.channel");
        logger.debug("debug");
        logger.warn("warn");
        logger.error("err");

        expect(sink.entries.map((e) => e.message)).toEqual(["err"]);
    });

    it("setLevel('off') for Off skips everything", () => {
        const service = new LogService();
        const sink = recordingSink();
        service.addSink(sink);
        service.setLevel("*", LogLevel.Off);

        const logger = service.createLogger("x");
        logger.error("err");

        expect(sink.entries).toHaveLength(0);
    });

    it("isEnabled(Off) is always false", () => {
        const service = new LogService();
        const logger = service.createLogger("x");
        expect(logger.isEnabled(LogLevel.Off)).toBe(false);
    });

    it("isEnabled reflects configured level", () => {
        const service = new LogService();
        service.setLevel("*", LogLevel.Warn);
        const logger = service.createLogger("x");
        expect(logger.isEnabled(LogLevel.Info)).toBe(false);
        expect(logger.isEnabled(LogLevel.Warn)).toBe(true);
        expect(logger.isEnabled(LogLevel.Error)).toBe(true);
    });
});

describe("LogService — channel hierarchy", () => {
    it("exact channel level wins over wildcard", () => {
        const service = new LogService();
        service.setLevel("*", LogLevel.Error);
        service.setLevel("noisy", LogLevel.Debug);

        expect(service.getLevel("noisy")).toBe(LogLevel.Debug);
        expect(service.getLevel("other")).toBe(LogLevel.Error);
    });

    it("parent segment level applies to sub-channels", () => {
        const service = new LogService();
        service.setLevel("*", LogLevel.Error);
        service.setLevel("extensions", LogLevel.Debug);

        expect(service.getLevel("extensions")).toBe(LogLevel.Debug);
        expect(service.getLevel("extensions.host")).toBe(LogLevel.Debug);
        expect(service.getLevel("extensions.host.stdout")).toBe(LogLevel.Debug);
    });

    it("nearest ancestor wins", () => {
        const service = new LogService();
        service.setLevel("a", LogLevel.Warn);
        service.setLevel("a.b", LogLevel.Debug);

        expect(service.getLevel("a")).toBe(LogLevel.Warn);
        expect(service.getLevel("a.b")).toBe(LogLevel.Debug);
        expect(service.getLevel("a.b.c")).toBe(LogLevel.Debug);
        expect(service.getLevel("a.x")).toBe(LogLevel.Warn);
    });

    it("setLevel after createLogger invalidates cached level", () => {
        const service = new LogService();
        const sink = recordingSink();
        service.addSink(sink);

        const logger = service.createLogger("x");
        logger.debug("first"); // default trace → passes
        service.setLevel("*", LogLevel.Error);
        logger.debug("second"); // now suppressed
        logger.error("third");

        expect(sink.entries.map((e) => e.message)).toEqual(["first", "third"]);
    });
});

describe("LogService — sinks", () => {
    it("fan-outs to all sinks", () => {
        const service = new LogService();
        const a = recordingSink();
        const b = recordingSink();
        service.addSink(a);
        service.addSink(b);

        service.createLogger("x").info("hi");

        expect(a.entries).toHaveLength(1);
        expect(b.entries).toHaveLength(1);
    });

    it("addSink returns disposable that detaches sink", () => {
        const service = new LogService();
        const sink = recordingSink();
        const sub = service.addSink(sink);

        service.createLogger("x").info("first");
        sub.dispose();
        service.createLogger("x").info("second");

        expect(sink.entries.map((e) => e.message)).toEqual(["first"]);
    });

    it("disposing the sink subscription twice is a no-op", () => {
        const service = new LogService();
        const sink = recordingSink();
        const sub = service.addSink(sink);

        sub.dispose();
        // Second dispose: sink already removed (indexOf < 0) — must not throw or
        // detach a different sink.
        expect(() => {
            sub.dispose();
        }).not.toThrow();

        service.createLogger("x").info("after");
        expect(sink.entries).toHaveLength(0);
    });

    it("a throwing sink does not break other sinks", () => {
        const service = new LogService();
        const bad: ILogSink = {
            append: () => {
                throw new Error("boom");
            },
            dispose: () => {},
        };
        const good = recordingSink();
        service.addSink(bad);
        service.addSink(good);

        service.createLogger("x").info("hi");

        expect(good.entries).toHaveLength(1);
    });
});

describe("LogService — onDidAppend", () => {
    it("notifies listeners with the entry", () => {
        const service = new LogService();
        const listener = vi.fn();
        service.onDidAppend(listener);

        service.createLogger("ch").warn("hello", 1, "two");

        expect(listener).toHaveBeenCalledOnce();
        const entry = listener.mock.calls[0][0] as LogEntry;
        expect(entry.channel).toBe("ch");
        expect(entry.level).toBe(LogLevel.Warn);
        expect(entry.message).toBe("hello");
        expect(entry.args).toEqual([1, "two"]);
        expect(typeof entry.timestamp).toBe("number");
    });

    it("disposable detaches listener", () => {
        const service = new LogService();
        const listener = vi.fn();
        const sub = service.onDidAppend(listener);

        service.createLogger("x").info("a");
        sub.dispose();
        service.createLogger("x").info("b");

        expect(listener).toHaveBeenCalledOnce();
    });

    it("listener throw is isolated", () => {
        const service = new LogService();
        service.onDidAppend(() => {
            throw new Error("boom");
        });
        const good = vi.fn();
        service.onDidAppend(good);

        service.createLogger("x").info("hi");

        expect(good).toHaveBeenCalledOnce();
    });
});

describe("LogService — entry shape", () => {
    it("emits args as passed", () => {
        const service = new LogService();
        const sink = recordingSink();
        service.addSink(sink);
        const logger = service.createLogger("ch");

        const err = new Error("oops");
        logger.error("failed", err, { extra: 1 });

        expect(sink.entries).toHaveLength(1);
        expect(sink.entries[0].args).toEqual([err, { extra: 1 }]);
    });

    it("timestamp is current time", () => {
        const service = new LogService();
        const sink = recordingSink();
        service.addSink(sink);
        const before = Date.now();
        service.createLogger("x").info("hi");
        const after = Date.now();
        expect(sink.entries[0].timestamp).toBeGreaterThanOrEqual(before);
        expect(sink.entries[0].timestamp).toBeLessThanOrEqual(after);
    });
});

describe("LogService — метки каналов", () => {
    it("канал без метки не регистрируется", () => {
        const service = new LogService();

        service.createLogger("anonymous");

        expect(service.getRegisteredChannels()).toEqual([]);
    });

    it("метку регистрирует первый создатель, повторный вызов её не меняет", () => {
        const service = new LogService();
        const seen: unknown[] = [];
        service.onDidRegisterChannel((descriptor) => seen.push(descriptor));

        service.createLogger("files.watcher", { label: "File Watcher" });
        service.createLogger("files.watcher", { label: "Другое имя" });
        service.createLogger("files.watcher");

        expect(service.getRegisteredChannels()).toEqual([{ id: "files.watcher", label: "File Watcher" }]);
        expect(seen).toEqual([{ id: "files.watcher", label: "File Watcher" }]);
    });

    it("порядок — порядок регистрации; отписка работает", () => {
        const service = new LogService();
        const seen: string[] = [];
        const subscription = service.onDidRegisterChannel((descriptor) => seen.push(descriptor.id));

        service.createLogger("b", { label: "B" });
        subscription.dispose();
        service.createLogger("a", { label: "A" });

        expect(service.getRegisteredChannels().map((d) => d.id)).toEqual(["b", "a"]);
        expect(seen).toEqual(["b"]);
    });
});
