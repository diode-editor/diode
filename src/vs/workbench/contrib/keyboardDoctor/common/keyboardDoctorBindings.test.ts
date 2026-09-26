import { describe, expect, it } from "vitest";

import { KeybindingRegistry, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { editorContextFor, lookupBindings } from "./keyboardDoctorBindings.ts";
import type { KeyboardDoctorEnv } from "./keyboardDoctorModel.ts";

const MAC_CMD: KeyboardDoctorEnv = {
    os: "mac",
    osSource: "env",
    tier: "kitty",
    macKeysRung: "cmd",
    capabilities: ["extended-keys", "kitty-graphics", "super"],
    modes: ["local"],
    terminalName: undefined,
    term: undefined,
};

describe("editorContextFor", () => {
    it("окружение и фокус «в редакторе» — в контекст-ключах", () => {
        const context = editorContextFor({ ...MAC_CMD, macKeysRung: "bogus" });
        expect(context.evaluate("isMac && tier == 'kitty' && macKeys == 0")).toBe(true);
        const cmd = editorContextFor(MAC_CMD);
        expect(cmd.evaluate("macKeys >= 3 && cap_super && cap_extendedKeys && cap_kittyGraphics")).toBe(true);
        expect(cmd.evaluate("mode_local && !mode_tmux && textViewFocus && textInputFocus")).toBe(true);
        expect(cmd.evaluate("isLinux || isWindows")).toBe(false);
        expect(cmd.evaluate("os == 'mac'")).toBe(true);
        const linux = editorContextFor({ ...MAC_CMD, os: "linux" });
        expect(linux.evaluate("isLinux && !isMac && !isWindows && os == 'linux'")).toBe(true);
        const windows = editorContextFor({ ...MAC_CMD, os: "windows" });
        expect(windows.evaluate("isWindows && !isMac && !isLinux")).toBe(true);
    });
});

describe("lookupBindings", () => {
    it("все бинды комбинации — с пометкой, действует ли каждый в этом окружении", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("mod+s"), "save");
        registry.register(parseKeybinding("meta+s"), "other", "listFocus");
        registry.register(parseKeybinding("ctrl+s"), "unrelated", "isLinux");

        expect(lookupBindings(registry, parseKeybinding("meta+s"), MAC_CMD)).toEqual([
            { commandId: "save", when: "macKeys >= 3", active: true },
            { commandId: "other", when: "listFocus", active: false },
        ]);
        expect(lookupBindings(registry, parseKeybinding("ctrl+s"), MAC_CMD)).toEqual([
            { commandId: "save", when: "macKeys < 3", active: false },
            { commandId: "unrelated", when: "isLinux", active: false },
        ]);
        expect(lookupBindings(registry, parseKeybinding("alt+s"), MAC_CMD)).toEqual([]);
    });

    it("бинд без условия действует всегда", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("f12"), "definition");
        expect(lookupBindings(registry, parseKeybinding("f12"), MAC_CMD)).toEqual([
            { commandId: "definition", when: undefined, active: true },
        ]);
    });
});
