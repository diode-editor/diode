import { describe, expect, it, vi } from "vitest";

import type { ILogger } from "../../log/common/iLogger.ts";

import { commandPaletteLabel, CommandRegistry } from "./commandRegistry.ts";

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

/** Lets the `then` chain on an already rejected promise run. */
function settleMicrotasks(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("CommandRegistry — shadowing an id", () => {
    it("the later registration wins; disposing it brings the previous handler and title back", () => {
        const registry = new CommandRegistry();
        const builtin = vi.fn();
        const override = vi.fn();
        registry.register("type", builtin, "Built-in");
        const shadow = registry.register("type", override);

        registry.execute("type");
        expect(override).toHaveBeenCalledOnce();
        expect(builtin).not.toHaveBeenCalled();
        expect(registry.getTitle("type")).toBeUndefined();
        expect(registry.listCommands()).toEqual([]);
        expect(registry.listCommandIds()).toEqual(["type"]);

        shadow.dispose();
        registry.execute("type");
        expect(builtin).toHaveBeenCalledOnce();
        expect(registry.getTitle("type")).toBe("Built-in");
        expect(registry.listCommands().map((command) => command.id)).toEqual(["type"]);
    });

    it("disposing a shadowed registration leaves the one in force", () => {
        const registry = new CommandRegistry();
        const first = vi.fn();
        const second = vi.fn();
        const shadowed = registry.register("c", first);
        registry.register("c", second);

        shadowed.dispose();
        registry.execute("c");
        expect(second).toHaveBeenCalledOnce();
        expect(first).not.toHaveBeenCalled();
    });

    it("a second dispose does not take another registration of the same handler with it", () => {
        const registry = new CommandRegistry();
        const handler = vi.fn();
        const first = registry.register("c", handler);
        registry.register("c", handler);

        first.dispose();
        first.dispose();
        expect(registry.has("c")).toBe(true);
    });

    it("the last dispose removes the id; a dispose after that does nothing", () => {
        const registry = new CommandRegistry();
        const only = registry.register("c", vi.fn());
        only.dispose();
        expect(registry.has("c")).toBe(false);
        expect(registry.listCommandIds()).toEqual([]);
        only.dispose();
        expect(registry.has("c")).toBe(false);
    });
});

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

    it("returns the promise of an async command as is — the awaiter sees the real rejection", async () => {
        const registry = new CommandRegistry();
        registry.register("cmd.async", () => Promise.reject(new Error("boom")));

        await expect(registry.execute("cmd.async")).rejects.toThrow("boom");
    });

    it("a forgotten rejection of an async command is not left unhandled and goes to the log", async () => {
        const errors: string[] = [];
        const registry = new CommandRegistry(makeLogger(errors));
        registry.register("cmd.async", () => Promise.reject(new Error("boom")));

        // The result is NOT awaited, exactly like the key dispatcher and a menu item. Without
        // a rejection handler Node would kill the process, losing all buffers.
        registry.execute("cmd.async");
        await settleMicrotasks();

        // The stack in the line is intentional: "Error: boom" alone does not reveal the culprit service.
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('command "cmd.async" failed: Error: boom');
    });

    it("a successful async command does not write to the log", async () => {
        const errors: string[] = [];
        const registry = new CommandRegistry(makeLogger(errors));
        registry.register("cmd.async", () => Promise.resolve("ok"));

        registry.execute("cmd.async");
        await settleMicrotasks();

        expect(errors).toEqual([]);
    });

    it("without a logger a forgotten rejection is still handled (minimal test containers)", async () => {
        const registry = new CommandRegistry();
        registry.register("cmd.async", () => Promise.reject(new Error("boom")));

        registry.execute("cmd.async");

        await expect(settleMicrotasks()).resolves.toBeUndefined();
    });

    it("listCommands returns the command category", () => {
        const registry = new CommandRegistry();
        registry.register("java.clean", () => undefined, "Clean Workspace", undefined, "Java");
        registry.register("files.save", () => undefined, "Save");

        expect(registry.listCommands()).toEqual([
            { id: "java.clean", title: "Clean Workspace", enablement: undefined, category: "Java" },
            { id: "files.save", title: "Save", enablement: undefined, category: undefined },
        ]);
    });

    it("getTitle does NOT prepend the category: the menu item label stays the title", () => {
        const registry = new CommandRegistry();
        registry.register("java.clean", () => undefined, "Clean Workspace", undefined, "Java");

        expect(registry.getTitle("java.clean")).toBe("Clean Workspace");
    });
});

describe("commandPaletteLabel", () => {
    it("joins category and title with `: ` (as upstream)", () => {
        expect(commandPaletteLabel({ title: "Switch to Standard Mode", category: "Java" })).toBe(
            "Java: Switch to Standard Mode",
        );
    });

    it("without a category returns the title itself", () => {
        expect(commandPaletteLabel({ title: "Save" })).toBe("Save");
        expect(commandPaletteLabel({ title: "Save", category: undefined })).toBe("Save");
    });

    it("an empty category adds no prefix", () => {
        expect(commandPaletteLabel({ title: "Save", category: "" })).toBe("Save");
    });
});
