import { describe, expect, it, vi } from "vitest";

import type { ILogger } from "../../log/common/iLogger.ts";

import { commandPaletteLabel, CommandRegistry } from "./commandRegistry.ts";

/** Логгер-фейк: копит только error-строки — остальные уровни здесь не нужны. */
function makeLogger(sink: string[]): ILogger {
    return {
        trace: () => undefined,
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: (message) => sink.push(message),
        isEnabled: () => true,
    };
}

/** Даёт отработать цепочке `then` на уже отклонённом промисе. */
function settleMicrotasks(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("CommandRegistry", () => {
    it("executes a registered command", () => {
        const registry = new CommandRegistry();
        const handler = vi.fn();
        registry.register("test.command", handler);

        registry.execute("test.command");

        expect(handler).toHaveBeenCalledOnce();
    });

    it("passes arguments to the handler", () => {
        const registry = new CommandRegistry();
        const handler = vi.fn();
        registry.register("test.command", handler);

        registry.execute("test.command", "arg1", 42);

        expect(handler).toHaveBeenCalledWith("arg1", 42);
    });

    it("returns handler result", () => {
        const registry = new CommandRegistry();
        registry.register("test.command", () => "result");

        const result = registry.execute("test.command");

        expect(result).toBe("result");
    });

    it("returns undefined for unknown command", () => {
        const registry = new CommandRegistry();

        const result = registry.execute("unknown.command");

        expect(result).toBeUndefined();
    });

    it("has() returns true for registered command", () => {
        const registry = new CommandRegistry();
        registry.register("test.command", () => {
            /* noop */
        });

        expect(registry.has("test.command")).toBe(true);
    });

    it("has() returns false for unregistered command", () => {
        const registry = new CommandRegistry();

        expect(registry.has("test.command")).toBe(false);
    });

    it("getTitle() returns the registered title, or undefined", () => {
        const registry = new CommandRegistry();
        registry.register("with.title", () => {}, "With Title");
        registry.register("no.title", () => {});

        expect(registry.getTitle("with.title")).toBe("With Title");
        expect(registry.getTitle("no.title")).toBeUndefined();
        expect(registry.getTitle("unregistered")).toBeUndefined();
    });

    it("unregisters command via returned disposable", () => {
        const registry = new CommandRegistry();
        const disposable = registry.register("test.command", () => {
            /* noop */
        });

        disposable.dispose();

        expect(registry.has("test.command")).toBe(false);
    });

    it("disposable does not remove a re-registered handler", () => {
        const registry = new CommandRegistry();
        const disposable = registry.register("test.command", () => "old");
        registry.register("test.command", () => "new");

        disposable.dispose();

        expect(registry.has("test.command")).toBe(true);
        expect(registry.execute("test.command")).toBe("new");
    });

    it("dispose() clears all handlers", () => {
        const registry = new CommandRegistry();
        registry.register("cmd.a", () => {
            /* noop */
        });
        registry.register("cmd.b", () => {
            /* noop */
        });

        registry.dispose();

        expect(registry.has("cmd.a")).toBe(false);
        expect(registry.has("cmd.b")).toBe(false);
    });

    it("listCommands() returns commands registered with title", () => {
        const registry = new CommandRegistry();
        registry.register("cmd.a", () => {}, "Command A");
        registry.register("cmd.b", () => {}, "Command B");

        const list = registry.listCommands();

        expect(list).toContainEqual({ id: "cmd.a", title: "Command A" });
        expect(list).toContainEqual({ id: "cmd.b", title: "Command B" });
    });

    it("listCommands() excludes commands registered without title", () => {
        const registry = new CommandRegistry();
        registry.register("cmd.with", () => {}, "With Title");
        registry.register("cmd.without", () => {});

        const list = registry.listCommands();

        expect(list.map((c) => c.id)).toContain("cmd.with");
        expect(list.map((c) => c.id)).not.toContain("cmd.without");
    });

    it("listCommands() returns empty array when no titled commands", () => {
        const registry = new CommandRegistry();
        registry.register("cmd.a", () => {});

        expect(registry.listCommands()).toHaveLength(0);
    });

    it("listCommands() does not include disposed command", () => {
        const registry = new CommandRegistry();
        const disposable = registry.register("cmd.a", () => {}, "Command A");
        disposable.dispose();

        expect(registry.listCommands()).toHaveLength(0);
    });

    it("returns the promise of an async command as is — ждущий видит настоящий отказ", async () => {
        const registry = new CommandRegistry();
        registry.register("cmd.async", () => Promise.reject(new Error("boom")));

        await expect(registry.execute("cmd.async")).rejects.toThrow("boom");
    });

    it("забытый отказ асинхронной команды не остаётся необработанным и уезжает в лог", async () => {
        const errors: string[] = [];
        const registry = new CommandRegistry(makeLogger(errors));
        registry.register("cmd.async", () => Promise.reject(new Error("boom")));

        // Результат НЕ ждём — ровно как диспетчер клавиш и пункт меню. Без
        // обработчика отказа Node убил бы процесс, унеся все буферы.
        registry.execute("cmd.async");
        await settleMicrotasks();

        // Стек в строке — намеренно: по «Error: boom» не найти виноватый сервис.
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('command "cmd.async" failed: Error: boom');
    });

    it("успешная асинхронная команда в лог не пишет", async () => {
        const errors: string[] = [];
        const registry = new CommandRegistry(makeLogger(errors));
        registry.register("cmd.async", () => Promise.resolve("ok"));

        registry.execute("cmd.async");
        await settleMicrotasks();

        expect(errors).toEqual([]);
    });

    it("без логгера забытый отказ всё равно обработан (минимальные контейнеры тестов)", async () => {
        const registry = new CommandRegistry();
        registry.register("cmd.async", () => Promise.reject(new Error("boom")));

        registry.execute("cmd.async");

        await expect(settleMicrotasks()).resolves.toBeUndefined();
    });

    it("listCommands отдаёт категорию команды", () => {
        const registry = new CommandRegistry();
        registry.register("java.clean", () => undefined, "Clean Workspace", undefined, "Java");
        registry.register("files.save", () => undefined, "Save");

        expect(registry.listCommands()).toEqual([
            { id: "java.clean", title: "Clean Workspace", enablement: undefined, category: "Java" },
            { id: "files.save", title: "Save", enablement: undefined, category: undefined },
        ]);
    });

    it("getTitle категорию НЕ приклеивает: подпись пункта меню остаётся заголовком", () => {
        const registry = new CommandRegistry();
        registry.register("java.clean", () => undefined, "Clean Workspace", undefined, "Java");

        expect(registry.getTitle("java.clean")).toBe("Clean Workspace");
    });
});

describe("commandPaletteLabel", () => {
    it("склеивает категорию и заголовок через `: ` (эталон VS Code)", () => {
        expect(commandPaletteLabel({ title: "Switch to Standard Mode", category: "Java" })).toBe(
            "Java: Switch to Standard Mode",
        );
    });

    it("без категории — сам заголовок", () => {
        expect(commandPaletteLabel({ title: "Save" })).toBe("Save");
        expect(commandPaletteLabel({ title: "Save", category: undefined })).toBe("Save");
    });

    it("пустая категория префикса не даёт", () => {
        expect(commandPaletteLabel({ title: "Save", category: "" })).toBe("Save");
    });
});
