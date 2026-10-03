import { describe, expect, it } from "vitest";

import type { KeyboardEventLike } from "./keybindingRegistry.ts";
import { KeybindingRegistry, parseChord, parseKeybinding } from "./keybindingRegistry.ts";

function makeEvent(overrides: Partial<KeyboardEventLike> & { key: string }): KeyboardEventLike {
    return {
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        ...overrides,
    };
}

describe("KeybindingRegistry — args у записи", () => {
    it("резолюция команды несёт args, зарегистрированные с биндингом", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("f6"), "test.open", undefined, "user", "prefill");

        const res = registry.resolveKey(makeEvent({ key: "F6" }));

        expect(res).toEqual({ kind: "command", commandId: "test.open", when: undefined, args: "prefill" });
    });

    it("биндинг без args резолвится с args === undefined", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("f6"), "test.open");

        const res = registry.resolveKey(makeEvent({ key: "F6" }));

        expect(res.kind).toBe("command");
        expect(res.kind === "command" && res.args).toBeUndefined();
    });

    it("args может быть произвольным значением (объект доезжает как есть)", () => {
        const registry = new KeybindingRegistry();
        const args = { text: "src/", revealIfOpen: true };
        registry.register(parseKeybinding("f6"), "test.open", undefined, "user", args);

        const res = registry.resolveKey(makeEvent({ key: "F6" }));

        expect(res.kind === "command" && res.args).toBe(args);
    });

    it("аккорд доносит args до завершающей комбинации", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+k ctrl+o"), "test.chord", undefined, "user", 42);

        expect(registry.resolveKey(makeEvent({ key: "k", ctrlKey: true })).kind).toBe("chord");
        const res = registry.resolveKey(makeEvent({ key: "o", ctrlKey: true }));

        expect(res).toEqual({ kind: "command", commandId: "test.chord", when: undefined, args: 42 });
    });

    it("снапшот listBindings и правило слоя user сохраняют args", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("f6"), "test.open", "textViewFocus", "default", "prefill");
        registry.setUserKeybindings([{ command: "test.user", chord: parseChord("f7"), args: { query: "x" } }]);

        const listed = registry.listBindings().find((entry) => entry.commandId === "test.open");
        expect(listed?.args).toBe("prefill");
        expect(registry.resolveKey(makeEvent({ key: "F7" }))).toEqual({
            kind: "command",
            commandId: "test.user",
            when: undefined,
            args: { query: "x" },
        });
    });
});
