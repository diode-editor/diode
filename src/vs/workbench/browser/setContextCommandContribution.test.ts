import { describe, expect, it } from "vitest";

import { CommandRegistry } from "../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../platform/contextkey/common/contextKeyService.ts";

import { normalizeContextValue, SetContextCommandContribution } from "./setContextCommandContribution.ts";

function setup(): { commands: CommandRegistry; contextKeys: ContextKeyService } {
    const commands = new CommandRegistry();
    const contextKeys = new ContextKeyService();
    new SetContextCommandContribution(commands, contextKeys);
    return { commands, contextKeys };
}

describe("SetContextCommandContribution", () => {
    // Ровно тот вызов, которым сторонние расширения публикуют свои when-ключи;
    // до регистрации команды он отклонялся как «команда не найдена».
    it("setContext кладёт значение в when-контекст, и when-выражение его видит", () => {
        const { commands, contextKeys } = setup();

        commands.execute("setContext", "supermaven.hasJumped", true);

        expect(contextKeys.evaluate("supermaven.hasJumped")).toBe(true);
    });

    it("повторный вызов перезаписывает значение", () => {
        const { commands, contextKeys } = setup();

        commands.execute("setContext", "myext.armed", true);
        commands.execute("setContext", "myext.armed", false);

        expect(contextKeys.evaluate("myext.armed")).toBe(false);
    });

    it("строки и числа доезжают сравнениями", () => {
        const { commands, contextKeys } = setup();

        commands.execute("setContext", "myext.mode", "fast");
        commands.execute("setContext", "myext.count", 3);

        expect(contextKeys.evaluate("myext.mode == 'fast'")).toBe(true);
        expect(contextKeys.evaluate("myext.count > 2")).toBe(true);
    });

    it("пустой или нестроковый ключ игнорируется", () => {
        const { commands, contextKeys } = setup();

        expect(commands.execute("setContext", "", true)).toBeUndefined();
        expect(commands.execute("setContext", 42, true)).toBeUndefined();
        expect(commands.execute("setContext")).toBeUndefined();

        // Ни один мусорный ключ не должен был протечь в набор имён вычислителя:
        // негодное имя ломает компиляцию, то есть ВСЕ when-выражения сразу.
        contextKeys.set("textInputFocus", true);
        expect(contextKeys.evaluate("textInputFocus")).toBe(true);
    });

    // В палитре VS Code `setContext` нет — это программный шов, не действие.
    it("команда без title — в палитру не попадает", () => {
        const { commands } = setup();
        expect(commands.listCommands().some((c) => c.id === "setContext")).toBe(false);
    });

    it("dispose снимает регистрацию", () => {
        const commands = new CommandRegistry();
        const contribution = new SetContextCommandContribution(commands, new ContextKeyService());
        expect(commands.has("setContext")).toBe(true);

        contribution.dispose();
        expect(commands.has("setContext")).toBe(false);
    });
});

describe("normalizeContextValue", () => {
    it("примитивы проходят как есть", () => {
        expect(normalizeContextValue(true)).toBe(true);
        expect(normalizeContextValue(false)).toBe(false);
        expect(normalizeContextValue("ready")).toBe("ready");
        expect(normalizeContextValue("")).toBe("");
        expect(normalizeContextValue(0)).toBe(0);
        expect(normalizeContextValue(-1.5)).toBe(-1.5);
    });

    it("null/undefined — это false: у нас непрописанный ключ читается так же", () => {
        expect(normalizeContextValue(null)).toBe(false);
        expect(normalizeContextValue(undefined)).toBe(false);
    });

    // NaN/Infinity как значение ключа бессмысленны, а сравнения с ними всегда
    // ложны — храним истинность, чтобы `when: "ext.key"` вело себя предсказуемо.
    it("NaN и Infinity сводятся к своей истинности", () => {
        expect(normalizeContextValue(Number.NaN)).toBe(false);
        expect(normalizeContextValue(Number.POSITIVE_INFINITY)).toBe(true);
    });

    // Массивы/объекты VS Code хранит целиком (под оператор `in`), наш
    // вычислитель работает с примитивами — сохраняем хотя бы истинность.
    it("массивы и объекты сводятся к своей истинности", () => {
        expect(normalizeContextValue([])).toBe(true);
        expect(normalizeContextValue(["a"])).toBe(true);
        expect(normalizeContextValue({})).toBe(true);
    });
});
