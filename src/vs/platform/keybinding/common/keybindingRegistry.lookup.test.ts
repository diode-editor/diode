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

describe("KeybindingRegistry — подпись выбирается по доставляемости", () => {
    /** Как объявляют бинды дефолты: канонический под tier-гейтом + досягаемый везде фолбэк. */
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

    it("на legacy подписывает фолбэк, хотя в объявлении он идёт первым и условным", () => {
        // Иначе палитра обещала бы Shift+Alt+F: в legacy это `ESC F` без
        // shift-флага, и нажатие подсказанного ничего не делает.
        const chord = gatedPlusFallback().getKeybindingForCommand("format", contextFor("legacy"));
        expect(chord && formatKeybinding(chord)).toBe("Ctrl+K Ctrl+E");
    });

    it("на kitty подписывает канонический бинд: tier-гейт — признак «объявлен для этого терминала»", () => {
        const chord = gatedPlusFallback().getKeybindingForCommand("format", contextFor("kitty"));
        expect(chord && formatKeybinding(chord)).toBe("Shift+Alt+F");
    });

    it("безусловный доставляемый бинд обгоняет недоставляемый условный", () => {
        // Палитра: Ctrl+Shift+P проходит по `when` и на legacy, но до приложения
        // не доходит — подписывать надо F1.
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+shift+p"), "palette", "!(macKeys >= 3)");
        registry.register(parseKeybinding("f1"), "palette");
        const chord = registry.getKeybindingForCommand("palette", contextFor("legacy"));
        expect(chord && formatKeybinding(chord)).toBe("F1");
    });

    it("когда доставляемого бинда нет вовсе, подпись — прежний приоритет", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+shift+m"), "problems", "!(macKeys >= 3)");
        const chord = registry.getKeybindingForCommand("problems", contextFor("legacy"));
        expect(chord && formatKeybinding(chord)).toBe("Ctrl+Shift+M");
    });

    it("без контекста tier неизвестен — подпись по порядку регистрации", () => {
        const chord = gatedPlusFallback().getKeybindingForCommand("format");
        expect(chord && formatKeybinding(chord)).toBe("Ctrl+K Ctrl+E");
    });
});

describe("KeybindingRegistry — getKeybindingForCommand с overlay", () => {
    it("бинд под фокус-ключом находится «как если бы в фокусе», не трогая контекст", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("mod+enter"), "commit", "scmInputFocus");
        const contextKeys = new ContextKeyService();
        contextKeys.set("macKeys", 3);
        // Без overlay фокуса нет: ни один when не проходит — берётся первый зарегистрированный (Ctrl-вариант).
        expect(formatKeybinding(registry.getKeybindingForCommand("commit", contextKeys)!)).toBe("Ctrl+Enter");
        expect(
            formatKeybinding(registry.getKeybindingForCommand("commit", contextKeys, { scmInputFocus: true })!),
        ).toBe("Meta+Enter");
        expect(contextKeys.evaluate("scmInputFocus")).toBe(false);
    });
});

describe("KeybindingRegistry — подпись по приоритету резолвера", () => {
    const label = (registry: KeybindingRegistry, commandId: string, contextKeys?: ContextKeyService): string =>
        formatKeybinding(registry.getKeybindingForCommand(commandId, contextKeys)!);

    it("пользовательский бинд команды подписывается вместо дефолта (старший слой — первым)", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+s"), "save");
        registry.setUserKeybindings([{ command: "save", chord: parseChord("ctrl+alt+s") }]);
        expect(label(registry, "save")).toBe("Ctrl+Alt+S");
    });

    it("комбинацию, которую перехватывает более сильная запись другой команды, не обещает", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+i"), "builtin");
        registry.register(parseKeybinding("ctrl+alt+i"), "builtin");
        registry.setExtensionKeybindings([{ command: "ext.cmd", chord: parseChord("ctrl+i") }]);
        expect(label(registry, "builtin")).toBe("Ctrl+Alt+I");
        // Сам перехватчик свою комбинацию подписывает.
        expect(label(registry, "ext.cmd")).toBe("Ctrl+I");
    });

    it("перехват считается только активной записью: when перехватчика не прошёл — подпись прежняя", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+i"), "builtin");
        registry.register(parseKeybinding("ctrl+alt+i"), "builtin");
        registry.register(parseKeybinding("ctrl+i"), "popup", "popupVisible");
        const contextKeys = new ContextKeyService();

        expect(label(registry, "builtin", contextKeys)).toBe("Ctrl+I");
        contextKeys.setRaw("popupVisible", true);
        expect(label(registry, "builtin", contextKeys)).toBe("Ctrl+Alt+I");
    });

    it("более слабая запись другой команды на той же комбинации не мешает", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+i"), "weak");
        registry.register(parseKeybinding("ctrl+i"), "strong");
        registry.register(parseKeybinding("ctrl+alt+i"), "strong");
        expect(label(registry, "strong")).toBe("Ctrl+I");
    });

    it("чорд, чей префикс — полная комбинация другой команды, недостижим", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseChord("ctrl+k ctrl+s"), "chorded");
        registry.register(parseKeybinding("f2"), "chorded");
        // Слабее по весу, но полное совпадение на первой клавише побеждает всегда.
        registry.register(parseKeybinding("ctrl+k"), "short", undefined, "default", undefined, { weight: -1 });
        expect(label(registry, "chorded")).toBe("F2");
    });

    it("без доступной комбинации — канонический (первый) бинд команды", () => {
        const registry = new KeybindingRegistry();
        registry.register(parseKeybinding("ctrl+i"), "builtin");
        registry.register(parseKeybinding("ctrl+i"), "popup");
        expect(label(registry, "builtin")).toBe("Ctrl+I");
    });
});
