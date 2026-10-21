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

        const chord = registry.getKeybindingForCommand("go", ctx);
        expect(chord && formatKeybinding(chord)).toBe("Ctrl+S");
    });

    it("shows the tier-specific chord fallback when the tier matches (Show All Commands on legacy)", () => {
        // The shape of quick-open actions: an unconditional binding plus a fallback active
        // only on legacy terminals (the command palette's own fallback is F1; a chord is used
        // here to also check formatting of a chord fallback).
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

        const chord = registry.getKeybindingForCommand("go", ctx);
        expect(chord && formatKeybinding(chord)).toBe("Ctrl+S");
    });
});

describe("KeybindingRegistry: the label is chosen by deliverability", () => {
    function gatedPlusFallback(): KeybindingRegistry {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+k ctrl+e"), "format", "textInputFocus");
        registry.register(parseKeybinding("shift+alt+f"), "format", "textInputFocus && tier != 'legacy'");
        return registry;
    }

    function contextFor(tier: string): ContextKeyService {
        const contextKeys = new ContextKeyService();
        contextKeys.set("tier", tier);
        contextKeys.setRaw("textInputFocus", true);
        return contextKeys;
    }

    it("on legacy labels the fallback, even though it is declared first and conditional", () => {
        // Otherwise the command palette would promise Shift+Alt+F: on legacy that's `ESC F`
        // without the shift flag, and pressing the suggested key does nothing.
        const chord = gatedPlusFallback().getKeybindingForCommand("format", contextFor("legacy"));
        expect(chord && formatKeybinding(chord)).toBe("Ctrl+K Ctrl+E");
    });

    it("on kitty labels the canonical binding: the tier gate means 'declared for this terminal'", () => {
        const chord = gatedPlusFallback().getKeybindingForCommand("format", contextFor("kitty"));
        expect(chord && formatKeybinding(chord)).toBe("Shift+Alt+F");
    });

    it("an unconditional deliverable binding beats an undeliverable conditional one", () => {
        // Command palette: Ctrl+Shift+P passes `when` on legacy too, but never reaches
        // the app, so F1 is the one to label.
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+shift+p"), "palette", "!(macKeys >= 3)");
        registry.register(parseKeybinding("f1"), "palette");
        const chord = registry.getKeybindingForCommand("palette", contextFor("legacy"));
        expect(chord && formatKeybinding(chord)).toBe("F1");
    });

    it("when no binding is deliverable at all, the label follows the old priority", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+shift+m"), "problems", "!(macKeys >= 3)");
        const chord = registry.getKeybindingForCommand("problems", contextFor("legacy"));
        expect(chord && formatKeybinding(chord)).toBe("Ctrl+Shift+M");
    });

    it("without a context the tier is unknown; the label follows registration order", () => {
        const chord = gatedPlusFallback().getKeybindingForCommand("format");
        expect(chord && formatKeybinding(chord)).toBe("Ctrl+K Ctrl+E");
    });
});

describe("KeybindingRegistry: getKeybindingForCommand with overlay", () => {
    it("a binding under a focus key is found 'as if focused' without touching the context", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("mod+enter"), "commit", "scmInputFocus");
        const contextKeys = new ContextKeyService();
        contextKeys.set("macKeys", 3);
        // Without overlay there is no focus: no when passes, so the first registered one (the Ctrl variant) is used.
        expect(formatKeybinding(registry.getKeybindingForCommand("commit", contextKeys)!)).toBe("Ctrl+Enter");
        expect(
            formatKeybinding(registry.getKeybindingForCommand("commit", contextKeys, { scmInputFocus: true })!),
        ).toBe("Meta+Enter");
        expect(contextKeys.evaluate("scmInputFocus")).toBe(false);
    });
});

describe("KeybindingRegistry: label by resolver priority", () => {
    const label = (registry: KeybindingRegistry, commandId: string, contextKeys?: ContextKeyService): string =>
        formatKeybinding(registry.getKeybindingForCommand(commandId, contextKeys)!);

    it("a user binding of the command is labeled instead of the default (higher layer first)", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+s"), "save");
        registry.setUserKeybindings([{ command: "save", chord: parseChord("ctrl+alt+s") }]);
        expect(label(registry, "save")).toBe("Ctrl+Alt+S");
    });

    it("does not promise a keybinding that a stronger entry of another command intercepts", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+i"), "builtin");
        registry.register(parseKeybinding("ctrl+alt+i"), "builtin");
        registry.setExtensionKeybindings([{ command: "ext.cmd", chord: parseChord("ctrl+i") }]);
        expect(label(registry, "builtin")).toBe("Ctrl+Alt+I");
        expect(label(registry, "ext.cmd")).toBe("Ctrl+I");
    });

    it("only an active entry intercepts: if the interceptor's when fails, the label is unchanged", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+i"), "builtin");
        registry.register(parseKeybinding("ctrl+alt+i"), "builtin");
        registry.register(parseKeybinding("ctrl+i"), "popup", "popupVisible");
        const contextKeys = new ContextKeyService();

        expect(label(registry, "builtin", contextKeys)).toBe("Ctrl+I");
        contextKeys.setRaw("popupVisible", true);
        expect(label(registry, "builtin", contextKeys)).toBe("Ctrl+Alt+I");
    });

    it("a weaker entry of another command on the same keybinding does not interfere", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+i"), "weak");
        registry.register(parseKeybinding("ctrl+i"), "strong");
        registry.register(parseKeybinding("ctrl+alt+i"), "strong");
        expect(label(registry, "strong")).toBe("Ctrl+I");
    });

    it("a chord whose prefix is a full keybinding of another command is unreachable", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+k ctrl+s"), "chorded");
        registry.register(parseKeybinding("f2"), "chorded");
        // Lower weight, but a complete match on the first key always wins.
        registry.register(parseKeybinding("ctrl+k"), "short", undefined, "default", undefined, { weight: -1 });
        expect(label(registry, "chorded")).toBe("F2");
    });

    it("without an available keybinding: the command's canonical (first) binding", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+i"), "builtin");
        registry.register(parseKeybinding("ctrl+i"), "popup");
        expect(label(registry, "builtin")).toBe("Ctrl+I");
    });
});
