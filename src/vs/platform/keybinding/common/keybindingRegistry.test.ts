import { describe, expect, it } from "vitest";

import { ContextKeyService } from "../../contextkey/common/contextKeyService.ts";

import type { KeyboardEventLike } from "./keybindingRegistry.ts";
import { KeybindingRegistry, parseKeybinding } from "./keybindingRegistry.ts";

function kb(spec: string) {
    return parseKeybinding(spec);
}

function makeEvent(overrides: Partial<KeyboardEventLike> & { key: string }): KeyboardEventLike {
    return {
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        ...overrides,
    };
}

function resolve(registry: KeybindingRegistry, event: KeyboardEventLike, ctx?: ContextKeyService): string | undefined {
    const res = registry.resolveKey(event, ctx);
    return res.kind === "command" ? res.commandId : undefined;
}

describe("parseKeybinding", () => {
    it("parses a single letter key", () => {
        expect(parseKeybinding("a")).toEqual({
            key: "a",
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            metaKey: false,
        });
    });

    it("parses ctrl+key", () => {
        const result = parseKeybinding("ctrl+s");
        expect(result.ctrlKey).toBe(true);
        expect(result.key).toBe("s");
    });

    it("parses ctrl+shift+key", () => {
        const result = parseKeybinding("ctrl+shift+p");
        expect(result.ctrlKey).toBe(true);
        expect(result.shiftKey).toBe(true);
        expect(result.key).toBe("p");
    });

    it("parses alt+key", () => {
        const result = parseKeybinding("alt+z");
        expect(result.altKey).toBe(true);
        expect(result.key).toBe("z");
    });

    it("parses meta+key", () => {
        const result = parseKeybinding("meta+x");
        expect(result.metaKey).toBe(true);
        expect(result.key).toBe("x");
    });

    it("normalizes enter", () => {
        expect(parseKeybinding("enter").key).toBe("Enter");
    });

    it("normalizes escape", () => {
        expect(parseKeybinding("escape").key).toBe("Escape");
    });

    it("normalizes tab", () => {
        expect(parseKeybinding("tab").key).toBe("Tab");
    });

    it("normalizes arrow keys", () => {
        expect(parseKeybinding("up").key).toBe("ArrowUp");
        expect(parseKeybinding("down").key).toBe("ArrowDown");
        expect(parseKeybinding("left").key).toBe("ArrowLeft");
        expect(parseKeybinding("right").key).toBe("ArrowRight");
    });

    it("normalizes function keys", () => {
        expect(parseKeybinding("f1").key).toBe("F1");
        expect(parseKeybinding("f12").key).toBe("F12");
    });

    it("normalizes home/end/pageup/pagedown/delete/insert", () => {
        expect(parseKeybinding("home").key).toBe("Home");
        expect(parseKeybinding("end").key).toBe("End");
        expect(parseKeybinding("pageup").key).toBe("PageUp");
        expect(parseKeybinding("pagedown").key).toBe("PageDown");
        expect(parseKeybinding("delete").key).toBe("Delete");
        expect(parseKeybinding("insert").key).toBe("Insert");
    });

    it("normalizes space", () => {
        expect(parseKeybinding("space").key).toBe(" ");
    });

    it("normalizes backspace", () => {
        expect(parseKeybinding("backspace").key).toBe("Backspace");
    });

    it("is case-insensitive for spec", () => {
        const result = parseKeybinding("Ctrl+S");
        expect(result.ctrlKey).toBe(true);
        expect(result.key).toBe("s");
    });
});

describe("KeybindingRegistry", () => {
    it("resolves a matching keybinding", () => {
        const registry = new KeybindingRegistry();
        registry.register(kb("ctrl+s"), "workbench.action.files.save");

        const result = resolve(registry, makeEvent({ key: "s", ctrlKey: true }));

        expect(result).toBe("workbench.action.files.save");
    });

    it("returns undefined when no match", () => {
        const registry = new KeybindingRegistry();
        registry.register(kb("ctrl+s"), "workbench.action.files.save");

        const result = resolve(registry, makeEvent({ key: "q", ctrlKey: true }));

        expect(result).toBeUndefined();
    });

    it("does not match when modifiers differ", () => {
        const registry = new KeybindingRegistry();
        registry.register(kb("ctrl+s"), "save");

        expect(resolve(registry, makeEvent({ key: "s" }))).toBeUndefined();
        expect(resolve(registry, makeEvent({ key: "s", ctrlKey: true, shiftKey: true }))).toBeUndefined();
    });

    it("last registered wins on conflict", () => {
        const registry = new KeybindingRegistry();
        registry.register(kb("ctrl+s"), "first");
        registry.register(kb("ctrl+s"), "second");

        const result = resolve(registry, makeEvent({ key: "s", ctrlKey: true }));

        expect(result).toBe("second");
    });

    it("matches key case-insensitively", () => {
        const registry = new KeybindingRegistry();
        registry.register(kb("ctrl+s"), "save");

        const result = resolve(registry, makeEvent({ key: "S", ctrlKey: true }));

        expect(result).toBe("save");
    });

    describe("layout-independent matching via code", () => {
        it("matches ctrl+s when key is Cyrillic с but code is KeyS", () => {
            const registry = new KeybindingRegistry();
            registry.register(kb("ctrl+s"), "workbench.action.files.save");

            // Ctrl+с (Russian layout) with Kitty alternate-keys flag sends baseLayoutKey=115 ('s') → code='KeyS'
            const result = resolve(registry, makeEvent({ key: "\u0441", code: "KeyS", ctrlKey: true }));

            expect(result).toBe("workbench.action.files.save");
        });

        it("matches meta+s when key is Cyrillic с but code is KeyS", () => {
            const registry = new KeybindingRegistry();
            registry.register(kb("meta+s"), "save");

            const result = resolve(registry, makeEvent({ key: "\u0441", code: "KeyS", metaKey: true }));

            expect(result).toBe("save");
        });

        it("matches alt+s when key is Cyrillic \u0441 but code is KeyS", () => {
            const registry = new KeybindingRegistry();
            registry.register(kb("alt+s"), "do-something");

            // Alt+\u0441 in the Russian layout is the physical S key: Alt+S, as in VS Code
            const result = resolve(registry, makeEvent({ key: "\u0441", code: "KeyS", altKey: true }));

            expect(result).toBe("do-something");
            // The boundary: U+0080 is already outside ASCII, so it falls back too.
            expect(resolve(registry, makeEvent({ key: "\u0080", code: "KeyS", altKey: true }))).toBe("do-something");
        });

        it("does NOT code-fallback for alt+<Latin letter> (AZERTY Alt+a sits on KeyQ)", () => {
            const registry = new KeybindingRegistry();
            registry.register(kb("alt+q"), "quit");

            const result = resolve(registry, makeEvent({ key: "a", code: "KeyQ", altKey: true }));

            expect(result).toBeUndefined();
        });

        it("does NOT code-fallback when modifiers do not match", () => {
            const registry = new KeybindingRegistry();
            registry.register(kb("ctrl+s"), "save");

            const result = resolve(registry, makeEvent({ key: "\u0441", code: "KeyS" }));

            expect(result).toBeUndefined();
        });

        it("primary key match still works (English layout)", () => {
            const registry = new KeybindingRegistry();
            registry.register(kb("ctrl+s"), "save");

            const result = resolve(registry, makeEvent({ key: "s", code: "KeyS", ctrlKey: true }));

            expect(result).toBe("save");
        });
    });

    it("resolves special keys", () => {
        const registry = new KeybindingRegistry();
        registry.register(kb("ctrl+enter"), "exec");

        const result = resolve(registry, makeEvent({ key: "Enter", ctrlKey: true }));

        expect(result).toBe("exec");
    });

    it("unregisters via returned disposable", () => {
        const registry = new KeybindingRegistry();
        const disposable = registry.register(kb("ctrl+s"), "save");

        disposable.dispose();

        expect(resolve(registry, makeEvent({ key: "s", ctrlKey: true }))).toBeUndefined();
    });

    it("dispose() clears all bindings", () => {
        const registry = new KeybindingRegistry();
        registry.register(kb("ctrl+s"), "save");
        registry.register(kb("ctrl+q"), "quit");

        registry.dispose();

        expect(resolve(registry, makeEvent({ key: "s", ctrlKey: true }))).toBeUndefined();
        expect(resolve(registry, makeEvent({ key: "q", ctrlKey: true }))).toBeUndefined();
    });

    describe("when-context", () => {
        it("resolves binding with matching when-condition", () => {
            const registry = new KeybindingRegistry();
            const ctx = new ContextKeyService();
            ctx.set("textInputFocus", true);
            registry.register(kb("pagedown"), "cursorPageDown", "textInputFocus");

            expect(resolve(registry, makeEvent({ key: "PageDown" }), ctx)).toBe("cursorPageDown");
        });

        it("skips binding when when-condition is false", () => {
            const registry = new KeybindingRegistry();
            const ctx = new ContextKeyService();
            registry.register(kb("pagedown"), "cursorPageDown", "textInputFocus");

            expect(resolve(registry, makeEvent({ key: "PageDown" }), ctx)).toBeUndefined();
        });

        it("selects correct binding among multiple with different when-conditions", () => {
            const registry = new KeybindingRegistry();
            const ctx = new ContextKeyService();
            registry.register(kb("pagedown"), "cursorPageDown", "textInputFocus");
            registry.register(kb("pagedown"), "list.focusPageDown", "listFocus");

            ctx.set("listFocus", true);
            expect(resolve(registry, makeEvent({ key: "PageDown" }), ctx)).toBe("list.focusPageDown");

            ctx.reset("listFocus");
            ctx.set("textInputFocus", true);
            expect(resolve(registry, makeEvent({ key: "PageDown" }), ctx)).toBe("cursorPageDown");
        });

        it("falls through to binding without when if no when-conditioned matches", () => {
            const registry = new KeybindingRegistry();
            const ctx = new ContextKeyService();
            registry.register(kb("pagedown"), "fallback");
            registry.register(kb("pagedown"), "cursorPageDown", "textInputFocus");

            expect(resolve(registry, makeEvent({ key: "PageDown" }), ctx)).toBe("fallback");
        });

        it("skips when-conditioned binding if no contextKeys provided", () => {
            const registry = new KeybindingRegistry();
            registry.register(kb("pagedown"), "cursorPageDown", "textInputFocus");

            expect(resolve(registry, makeEvent({ key: "PageDown" }))).toBeUndefined();
        });

        it("supports complex when-expressions", () => {
            const registry = new KeybindingRegistry();
            const ctx = new ContextKeyService();
            registry.register(kb("pagedown"), "combined", "textInputFocus && !listFocus");

            ctx.set("textInputFocus", true);
            expect(resolve(registry, makeEvent({ key: "PageDown" }), ctx)).toBe("combined");

            ctx.set("listFocus", true);
            expect(resolve(registry, makeEvent({ key: "PageDown" }), ctx)).toBeUndefined();
        });
    });
});
