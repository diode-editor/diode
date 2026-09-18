import { describe, expect, it } from "vitest";

import { ContextKeyService } from "../../contextkey/common/contextKeyService.ts";

import { formatKeybinding, KeybindingRegistry, parseChord, parseKeybinding } from "./keybindingRegistry.ts";

describe("KeybindingRegistry — getKeybindingForCommand", () => {
    it("returns undefined when the command has no binding", () => {
        const registry = new KeybindingRegistry();
        expect(registry.getKeybindingForCommand("missing")).toBeUndefined();
    });

    it("returns the single registered binding", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+s"), "save");
        const chord = registry.getKeybindingForCommand("save");
        expect(chord && formatKeybinding(chord)).toBe("Ctrl+S");
    });

    it("returns a chord binding", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+k s"), "save");
        const chord = registry.getKeybindingForCommand("save");
        expect(chord && formatKeybinding(chord)).toBe("Ctrl+K S");
    });

    it("with multiple unconditional bindings returns the first registered", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+s"), "save");
        registry.register(parseChord("ctrl+k s"), "save");
        const chord = registry.getKeybindingForCommand("save");
        expect(chord && formatKeybinding(chord)).toBe("Ctrl+S");
    });

    it("returns the binding whose when-condition matches the current context", () => {
        const registry = new KeybindingRegistry();
        const ctx = new ContextKeyService();
        registry.register(parseKeybinding("ctrl+s"), "go", "textInputFocus");
        registry.register(parseKeybinding("ctrl+l"), "go", "listFocus");

        ctx.set("listFocus", true);
        const chord = registry.getKeybindingForCommand("go", ctx);
        expect(chord && formatKeybinding(chord)).toBe("Ctrl+L");
    });

    it("falls back to the first registered binding when no when-condition matches", () => {
        const registry = new KeybindingRegistry();
        const ctx = new ContextKeyService();
        registry.register(parseKeybinding("ctrl+s"), "go", "textInputFocus");
        registry.register(parseKeybinding("ctrl+l"), "go", "listFocus");

        // Neither context key is set.
        const chord = registry.getKeybindingForCommand("go", ctx);
        expect(chord && formatKeybinding(chord)).toBe("Ctrl+S");
    });

    it("shows the tier-specific chord fallback when the tier matches (Show All Commands on legacy)", () => {
        // Форма quick-open-экшенов: безусловный бинд плюс фоллбэк, действующий
        // только на legacy-терминалах (у самой палитры фоллбэк — F1; здесь взят
        // аккорд, чтобы заодно проверить форматирование аккордного фоллбэка).
        const registry = new KeybindingRegistry();
        const ctx = new ContextKeyService();
        registry.register(parseKeybinding("ctrl+shift+p"), "workbench.action.showCommands");
        registry.register(parseChord("ctrl+k ctrl+p"), "workbench.action.showCommands", "tier == 'legacy'");

        ctx.set("tier", "legacy");
        const legacy = registry.getKeybindingForCommand("workbench.action.showCommands", ctx);
        expect(legacy && formatKeybinding(legacy)).toBe("Ctrl+K Ctrl+P");

        ctx.set("tier", "kitty");
        const modern = registry.getKeybindingForCommand("workbench.action.showCommands", ctx);
        expect(modern && formatKeybinding(modern)).toBe("Ctrl+Shift+P");
    });

    it("without a context service, returns the first registered binding", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+s"), "go", "textInputFocus");
        registry.register(parseKeybinding("ctrl+l"), "go", "listFocus");

        const chord = registry.getKeybindingForCommand("go");
        expect(chord && formatKeybinding(chord)).toBe("Ctrl+S");
    });

    it("prefers a matching when-conditioned binding over an earlier unconditional one", () => {
        // A context-specific binding (e.g. a tier-specific fallback) is the one
        // actually usable in that context, so it must win over the default for display.
        const registry = new KeybindingRegistry();
        const ctx = new ContextKeyService();
        registry.register(parseKeybinding("ctrl+s"), "go");
        registry.register(parseKeybinding("ctrl+l"), "go", "listFocus");

        ctx.set("listFocus", true);
        const chord = registry.getKeybindingForCommand("go", ctx);
        expect(chord && formatKeybinding(chord)).toBe("Ctrl+L");
    });

    it("falls back to the unconditional binding when the when-conditioned one does not match", () => {
        const registry = new KeybindingRegistry();
        const ctx = new ContextKeyService();
        registry.register(parseKeybinding("ctrl+s"), "go");
        registry.register(parseKeybinding("ctrl+l"), "go", "listFocus");

        // listFocus is not set, so the conditional binding does not apply.
        const chord = registry.getKeybindingForCommand("go", ctx);
        expect(chord && formatKeybinding(chord)).toBe("Ctrl+S");
    });
});
