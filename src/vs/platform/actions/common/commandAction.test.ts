import { describe, expect, it, vi } from "vitest";

import { CommandRegistry } from "../../commands/common/commandRegistry.ts";
import { ContextKeyService, ContextKeyServiceDIToken } from "../../contextkey/common/contextKeyService.ts";
import { Container, token } from "../../instantiation/common/diContainer.ts";
import type { KeyboardEventLike } from "../../keybinding/common/keybindingRegistry.ts";
import { KeybindingRegistry, parseChord, parseKeybinding } from "../../keybinding/common/keybindingRegistry.ts";

import type { CommandAction } from "./commandAction.ts";
import { combineWhen, registerAction } from "./commandAction.ts";

// Maps the structured resolveKey result to a command id (or undefined).
function resolve(
    keybindings: KeybindingRegistry,
    event: KeyboardEventLike,
    contextKeys?: ContextKeyService,
): string | undefined {
    const res = keybindings.resolveKey(event, contextKeys);
    return res.kind === "command" ? res.commandId : undefined;
}

const KEY = (key: string, mods: Partial<KeyboardEventLike> = {}): KeyboardEventLike => ({
    key,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...mods,
});

describe("registerAction", () => {
    it("registers command handler in CommandRegistry", () => {
        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        const accessor = new Container();
        const action: CommandAction = {
            id: "test.action",
            title: "Test Action",
            run: vi.fn(),
        };

        registerAction(commands, keybindings, accessor, action);

        expect(commands.has("test.action")).toBe(true);
    });

    it("passes accessor to run when command executes", () => {
        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        const accessor = new Container();
        const runFn = vi.fn();
        const action: CommandAction = {
            id: "test.action",
            title: "Test Action",
            run: runFn,
        };

        registerAction(commands, keybindings, accessor, action);
        commands.execute("test.action");

        expect(runFn).toHaveBeenCalledWith(accessor);
    });

    it("forwards extra args to run", () => {
        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        const accessor = new Container();
        const runFn = vi.fn();
        const action: CommandAction = {
            id: "test.action",
            title: "Test Action",
            run: runFn,
        };

        registerAction(commands, keybindings, accessor, action);
        commands.execute("test.action", "arg1", 42);

        expect(runFn).toHaveBeenCalledWith(accessor, "arg1", 42);
    });

    it("registers keybinding when specified", () => {
        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        const accessor = new Container();
        const action: CommandAction = {
            id: "test.action",
            title: "Test Action",
            keybinding: parseKeybinding("ctrl+s"),
            run: vi.fn(),
        };

        registerAction(commands, keybindings, accessor, action);

        const resolved = resolve(keybindings, {
            key: "s",
            ctrlKey: true,
            shiftKey: false,
            altKey: false,
            metaKey: false,
        });
        expect(resolved).toBe("test.action");
    });

    it("registers all keybindings when keybindings array is specified", () => {
        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        const accessor = new Container();
        const action: CommandAction = {
            id: "test.action",
            title: "Test Action",
            keybindings: [parseKeybinding("ctrl+s"), parseKeybinding("ctrl+pagedown")],
            run: vi.fn(),
        };

        registerAction(commands, keybindings, accessor, action);

        const resolvedCtrlS = resolve(keybindings, {
            key: "s",
            ctrlKey: true,
            shiftKey: false,
            altKey: false,
            metaKey: false,
        });
        expect(resolvedCtrlS).toBe("test.action");

        const resolvedCtrlPageDown = resolve(keybindings, {
            key: "PageDown",
            ctrlKey: true,
            shiftKey: false,
            altKey: false,
            metaKey: false,
        });
        expect(resolvedCtrlPageDown).toBe("test.action");
    });

    it("registers a chord binding that resolves across two key presses", () => {
        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        const accessor = new Container();
        const action: CommandAction = {
            id: "test.action",
            title: "Test Action",
            keybindings: [parseChord("ctrl+k s")],
            run: vi.fn(),
        };

        registerAction(commands, keybindings, accessor, action);

        const first = keybindings.resolveKey({
            key: "k",
            ctrlKey: true,
            shiftKey: false,
            altKey: false,
            metaKey: false,
        });
        expect(first.kind).toBe("chord");

        const second = keybindings.resolveKey({
            key: "s",
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            metaKey: false,
        });
        expect(second).toEqual({ kind: "command", commandId: "test.action" });
    });

    it("does not register keybinding when not specified", () => {
        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        const accessor = new Container();
        const action: CommandAction = {
            id: "test.action",
            title: "Test Action",
            run: vi.fn(),
        };

        registerAction(commands, keybindings, accessor, action);

        const resolved = resolve(keybindings, {
            key: "s",
            ctrlKey: true,
            shiftKey: false,
            altKey: false,
            metaKey: false,
        });
        expect(resolved).toBeUndefined();
    });

    it("dispose removes command and keybinding", () => {
        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        const accessor = new Container();
        const action: CommandAction = {
            id: "test.action",
            title: "Test Action",
            keybinding: parseKeybinding("ctrl+s"),
            run: vi.fn(),
        };

        const disposable = registerAction(commands, keybindings, accessor, action);
        disposable.dispose();

        expect(commands.has("test.action")).toBe(false);
        const resolved = resolve(keybindings, {
            key: "s",
            ctrlKey: true,
            shiftKey: false,
            altKey: false,
            metaKey: false,
        });
        expect(resolved).toBeUndefined();
    });

    it("a conditional binding only resolves when its per-binding when passes", () => {
        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        const accessor = new Container();
        const ctx = new ContextKeyService();
        const action: CommandAction = {
            id: "wordRight",
            title: "Word Right",
            keybinding: parseKeybinding("ctrl+right"),
            keybindings: [{ keys: parseKeybinding("alt+right"), when: "tier == 'legacy'" }],
            run: vi.fn(),
        };
        registerAction(commands, keybindings, accessor, action);

        // alt+right is gated on legacy.
        ctx.set("tier", "kitty");
        expect(resolve(keybindings, KEY("ArrowRight", { altKey: true }), ctx)).toBeUndefined();
        ctx.set("tier", "legacy");
        expect(resolve(keybindings, KEY("ArrowRight", { altKey: true }), ctx)).toBe("wordRight");

        // The unconditional ctrl+right works on every tier.
        ctx.set("tier", "kitty");
        expect(resolve(keybindings, KEY("ArrowRight", { ctrlKey: true }), ctx)).toBe("wordRight");
    });

    it("AND-combines action-wide when with per-binding when", () => {
        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        const accessor = new Container();
        const ctx = new ContextKeyService();
        const action: CommandAction = {
            id: "scoped",
            title: "Scoped",
            when: "textInputFocus",
            keybindings: [{ keys: parseKeybinding("alt+right"), when: "tier == 'legacy'" }],
            run: vi.fn(),
        };
        registerAction(commands, keybindings, accessor, action);

        ctx.set("tier", "legacy");
        ctx.set("textInputFocus", false);
        expect(resolve(keybindings, KEY("ArrowRight", { altKey: true }), ctx)).toBeUndefined();

        ctx.set("textInputFocus", true);
        expect(resolve(keybindings, KEY("ArrowRight", { altKey: true }), ctx)).toBe("scoped");
    });

    it("combineWhen joins both clauses, or returns whichever is present", () => {
        expect(combineWhen("a", "b")).toBe("(a) && (b)");
        expect(combineWhen("a", undefined)).toBe("a");
        expect(combineWhen(undefined, "b")).toBe("b");
        expect(combineWhen(undefined, undefined)).toBeUndefined();
    });

    it("run can access services via accessor", () => {
        const MyServiceToken = token<{ value: string }>("MyService");
        const container = new Container();
        container.bind(MyServiceToken, () => ({ value: "hello" }));

        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        const action: CommandAction = {
            id: "test.action",
            title: "Test Action",
            run(accessor) {
                return accessor.get(MyServiceToken).value;
            },
        };

        registerAction(commands, keybindings, container, action);
        const result = commands.execute("test.action");

        expect(result).toBe("hello");
    });
});

describe("registerAction — enablement", () => {
    function setup(action: CommandAction): {
        commands: CommandRegistry;
        keybindings: KeybindingRegistry;
        contextKeys: ContextKeyService;
    } {
        const commands = new CommandRegistry();
        const keybindings = new KeybindingRegistry();
        const contextKeys = new ContextKeyService();
        const container = new Container();
        container.bind(ContextKeyServiceDIToken, () => contextKeys);
        registerAction(commands, keybindings, container, action);
        return { commands, keybindings, contextKeys };
    }

    it("ложный enablement не даёт исполнить команду ниоткуда", () => {
        const run = vi.fn();
        const h = setup({ id: "git.commit", title: "Commit", enablement: "!gitOperationInProgress", run });

        h.contextKeys.set("gitOperationInProgress", true);
        expect(h.commands.execute("git.commit")).toBeUndefined();
        expect(run).not.toHaveBeenCalled();

        h.contextKeys.set("gitOperationInProgress", false);
        h.commands.execute("git.commit");
        expect(run).toHaveBeenCalledTimes(1);
    });

    it("enablement уезжает в when кейбинда — клавиша не проглатывается впустую", () => {
        const h = setup({
            id: "git.commit",
            title: "Commit",
            when: "scmInputFocus",
            enablement: "!gitOperationInProgress",
            keybinding: parseKeybinding("ctrl+enter"),
            run: vi.fn(),
        });

        h.contextKeys.set("scmInputFocus", true);
        expect(resolve(h.keybindings, KEY("Enter", { ctrlKey: true }), h.contextKeys)).toBe("git.commit");

        h.contextKeys.set("gitOperationInProgress", true);
        expect(resolve(h.keybindings, KEY("Enter", { ctrlKey: true }), h.contextKeys)).toBeUndefined();
    });

    it("команда без enablement не требует ContextKeyService в контейнере", () => {
        const commands = new CommandRegistry();
        const run = vi.fn();
        // Пустой контейнер: минимальные стенды тестов экшенов биндят только то,
        // что нужно самому экшену, и guard не должен этого ломать.
        registerAction(commands, new KeybindingRegistry(), new Container(), {
            id: "test.action",
            title: "Test",
            run,
        });

        commands.execute("test.action");
        expect(run).toHaveBeenCalledTimes(1);
    });

    it("реестр отдаёт enablement метаданными — их читает палитра", () => {
        const h = setup({ id: "git.push", title: "Git: Push", enablement: "gitHasRemotes", run: vi.fn() });
        expect(h.commands.listCommands()).toContainEqual({
            id: "git.push",
            title: "Git: Push",
            enablement: "gitHasRemotes",
        });
    });
});
