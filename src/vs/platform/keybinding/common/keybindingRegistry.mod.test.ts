import { describe, expect, it } from "vitest";

import { ContextKeyService } from "../../contextkey/common/contextKeyService.ts";

import {
    expandModKey,
    formatKeybinding,
    KeybindingRegistry,
    type KeyboardEventLike,
    parseChord,
    parseKeybinding,
} from "./keybindingRegistry.ts";
import { macKeysLevel, type MacKeysRung } from "./macKeys.ts";

function contextAt(rung: MacKeysRung | undefined): ContextKeyService {
    const contextKeys = new ContextKeyService();
    contextKeys.set("macKeys", macKeysLevel(rung));
    return contextKeys;
}

function press(key: string, mods: Partial<KeyboardEventLike> = {}): KeyboardEventLike {
    return { key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods };
}

describe("токен mod (Ctrl на pc, Cmd на mac-cmd)", () => {
    it("parseKeybinding понимает mod и не выставляет конкретный модификатор", () => {
        expect(parseKeybinding("mod+shift+s")).toEqual({
            key: "s",
            ctrlKey: false,
            shiftKey: true,
            altKey: false,
            metaKey: false,
            modKey: true,
        });
        expect(parseKeybinding("ctrl+s")).not.toHaveProperty("modKey");
    });

    it("expandModKey: чорд без mod — как есть", () => {
        const chord = parseChord("ctrl+k ctrl+s");
        expect(expandModKey(chord, "textInputFocus")).toEqual([{ chord, when: "textInputFocus" }]);
    });

    it("expandModKey: взаимоисключающие Ctrl-ниже-cmd и Cmd-на-cmd, каждая часть чорда", () => {
        const variants = expandModKey(parseChord("mod+k mod+s"), "textInputFocus");
        expect(variants.map((v) => [formatKeybinding(v.chord), v.when])).toEqual([
            ["Ctrl+K Ctrl+S", "(textInputFocus) && (macKeys < 3)"],
            ["Meta+K Meta+S", "(textInputFocus) && (macKeys >= 3)"],
        ]);
        expect(variants.flatMap((v) => v.chord).some((part) => "modKey" in part)).toBe(false);
        expect(expandModKey(parseChord("mod+s"), undefined).map((v) => v.when)).toEqual([
            "macKeys < 3",
            "macKeys >= 3",
        ]);
    });

    it.each<[MacKeysRung | undefined, string | undefined, string | undefined]>([
        [undefined, "save", undefined],
        ["legacy", "save", undefined],
        ["extended", "save", undefined],
        ["cmd", undefined, "save"],
    ])("рунг %s: Ctrl+S → %s, Cmd+S → %s", (rung, viaCtrl, viaCmd) => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("mod+s"), "save");
        const contextKeys = contextAt(rung);
        const resolve = (event: KeyboardEventLike): string | undefined => {
            const result = registry.resolveKey(event, contextKeys);
            return result.kind === "command" ? result.commandId : undefined;
        };
        expect(resolve(press("s", { ctrlKey: true }))).toBe(viaCtrl);
        expect(resolve(press("s", { metaKey: true }))).toBe(viaCmd);
    });

    it("отображение берёт вариант активного рунга", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("mod+p"), "quickOpen");
        expect(formatKeybinding(registry.getKeybindingForCommand("quickOpen", contextAt("legacy"))!)).toBe("Ctrl+P");
        expect(formatKeybinding(registry.getKeybindingForCommand("quickOpen", contextAt("cmd"))!)).toBe("Meta+P");
    });

    it("dispose снимает оба варианта", () => {
        const registry = new KeybindingRegistry();
        const other = registry.register(parseKeybinding("ctrl+o"), "open");
        const handle = registry.register(parseKeybinding("mod+s"), "save");
        expect(registry.listBindings()).toHaveLength(3);
        handle.dispose();
        handle.dispose(); // повторно — no-op
        expect(registry.listBindings().map((b) => b.commandId)).toEqual(["open"]);
        other.dispose();
    });
});
