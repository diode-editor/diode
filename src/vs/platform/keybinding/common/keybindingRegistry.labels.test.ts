import { describe, expect, it } from "vitest";

import { ContextKeyService } from "../../contextkey/common/contextKeyService.ts";

import { formatKeybinding, type KeybindingLabelStyle, keybindingLabelStyle, parseChord } from "./keybindingRegistry.ts";

// Подписи комбинаций по эталону VS Code (`keybindingLabels.ts`): на маке —
// глифы ⌃⇧⌥⌘ без разделителя в порядке Ctrl, Shift, Alt, Meta, стрелки — стрелками.

describe("formatKeybinding — стили подписи", () => {
    it.each<[string, KeybindingLabelStyle, string]>([
        ["meta+s", "pc", "Meta+S"],
        ["meta+s", "mac", "⌘S"],
        ["meta+s", "macWords", "Cmd+S"],
        ["ctrl+shift+alt+meta+k", "pc", "Ctrl+Shift+Alt+Meta+K"],
        ["ctrl+shift+alt+meta+k", "mac", "⌃⇧⌥⌘K"],
        ["ctrl+shift+alt+meta+k", "macWords", "Ctrl+Shift+Option+Cmd+K"],
        ["shift+meta+p", "mac", "⇧⌘P"],
        ["ctrl+a", "mac", "⌃A"],
        ["alt+left", "mac", "⌥←"],
        ["meta+up", "mac", "⌘↑"],
        ["meta+right", "mac", "⌘→"],
        ["meta+down", "mac", "⌘↓"],
        ["alt+left", "macWords", "Option+Left"],
        ["alt+left", "pc", "Alt+Left"],
        ["meta+backspace", "mac", "⌘Backspace"],
        ["ctrl+space", "mac", "⌃Space"],
        ["meta+k meta+s", "mac", "⌘K ⌘S"],
        ["ctrl+k ctrl+s", "pc", "Ctrl+K Ctrl+S"],
        ["f12", "mac", "F12"],
    ])("%s (%s) → %s", (spec, style, expected) => {
        expect(formatKeybinding(parseChord(spec), style)).toBe(expected);
    });

    it("по умолчанию — pc", () => {
        expect(formatKeybinding(parseChord("meta+s"))).toBe("Meta+S");
    });
});

describe("keybindingLabelStyle", () => {
    it("мак по контекст-ключу isMac (ОС клавиатуры), иначе и без контекста — pc", () => {
        const contextKeys = new ContextKeyService();
        expect(keybindingLabelStyle(contextKeys)).toBe("pc");
        contextKeys.set("isMac", true);
        expect(keybindingLabelStyle(contextKeys)).toBe("mac");
        contextKeys.set("isMac", false);
        expect(keybindingLabelStyle(contextKeys)).toBe("pc");
        expect(keybindingLabelStyle(undefined)).toBe("pc");
    });
});
