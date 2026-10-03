import { describe, expect, it } from "vitest";

import { ContextKeyService } from "../../contextkey/common/contextKeyService.ts";

import { KeybindingRegistry, parseChord, parseKeybinding, serializeChord } from "./keybindingRegistry.ts";
import { KeybindingWeight } from "./keybindingResolver.ts";

const ESCAPE = { key: "Escape", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
const CTRL_K = { key: "k", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false };

function resolve(registry: KeybindingRegistry, event = ESCAPE, contextKeys = new ContextKeyService()): unknown {
    const resolution = registry.resolveKey(event, contextKeys);
    registry.resetPending();
    return resolution.kind === "command" ? resolution.commandId : resolution.kind;
}

describe("KeybindingRegistry — вес правила", () => {
    it("тяжёлое правило побеждает зарегистрированное позже лёгкое", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("escape"), "popup.hide", undefined, "default", undefined, {
            weight: KeybindingWeight.EditorContrib,
        });
        registry.register(parseKeybinding("escape"), "editor.cancel");

        expect(resolve(registry)).toBe("popup.hide");
        // Порядок в listBindings — по возрастанию приоритета: сильнейший последним.
        expect(registry.listBindings().map((entry) => entry.commandId)).toEqual(["editor.cancel", "popup.hide"]);
    });

    it("при равном весе — по-прежнему последний зарегистрированный", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("escape"), "first");
        registry.register(parseKeybinding("escape"), "second");
        expect(resolve(registry)).toBe("second");
    });

    it("подпись чорда и подпись команды читают тот же приоритет", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+k ctrl+x"), "heavy", undefined, "default", undefined, { weight: 1 });
        registry.register(parseChord("ctrl+K ctrl+y"), "light");
        registry.register(parseKeybinding("f9"), "cmd", undefined, "default", undefined, { weight: 1 });
        registry.register(parseKeybinding("f8"), "cmd");

        expect(registry.resolveKey(CTRL_K, new ContextKeyService()).kind).toBe("chord");
        // Незавершённый чорд подписывается по сильнейшему кандидату.
        expect(serializeChord(registry.getPendingChord())).toBe("ctrl+k");
        registry.resetPending();
        // Безусловные бинды команды — в порядке приоритета: первым идёт слабейший (как раньше — первый зарегистрированный).
        expect(serializeChord(registry.getKeybindingForCommand("cmd")!)).toBe("f8");
    });
});

describe("KeybindingRegistry — подпись незавершённого чорда", () => {
    it("единственный кандидат (первая запись) даёт каноническую подпись, а не сырое событие", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+k ctrl+y"), "only");
        // Русская раскладка: клавиша «л», физически K — совпадение по code.
        const event = { key: "л", code: "KeyK", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false };

        expect(registry.resolveKey(event, new ContextKeyService()).kind).toBe("chord");
        expect(serializeChord(registry.getPendingChord())).toBe("ctrl+k");
    });
});

describe("KeybindingRegistry — кэш приоритета инвалидируется", () => {
    it("новое правило после чтения учитывается", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("escape"), "first");
        expect(resolve(registry)).toBe("first");
        registry.register(parseKeybinding("escape"), "second");
        expect(resolve(registry)).toBe("second");
    });

    it("снятое через dispose правило пропадает", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("escape"), "first");
        const second = registry.register(parseKeybinding("escape"), "second");
        expect(resolve(registry)).toBe("second");
        second.dispose();
        expect(resolve(registry)).toBe("first");
        expect(registry.listBindings().map((entry) => entry.commandId)).toEqual(["first"]);
    });

    it("removeBindings снимает и из кэша", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("escape"), "first");
        registry.register(parseKeybinding("escape"), "second");
        expect(resolve(registry)).toBe("second");
        registry.removeBindings("second");
        expect(resolve(registry)).toBe("first");
    });

    it("dispose реестра очищает и кэш", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("escape"), "first");
        expect(resolve(registry)).toBe("first");
        registry.dispose();
        expect(resolve(registry)).toBe("none");
        expect(registry.listBindings()).toEqual([]);
    });
});
