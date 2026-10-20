import { describe, expect, it, vi } from "vitest";

import { createTestConfigurationService } from "../../../../TestUtils/testConfigurationService.ts";

import { ContextKeyService } from "./contextKeyService.ts";

// `config.*` в when — настройки как контекст-ключи (`ConfigAwareContextValuesContainer`
// эталона): чтение без регистрации, кэш, сброс и событие на смене настройки.

const flush = (): Promise<void> =>
    new Promise((resolve) => {
        queueMicrotask(resolve);
    });

describe("ContextKeyService — ключи config.*", () => {
    it("читает настройку: дефолт схемы, пользовательское значение, чужой ключ расширения", () => {
        const configuration = createTestConfigurationService({ "claudeCode.useTerminal": true });
        const keys = new ContextKeyService(configuration);
        expect(keys.evaluate("config.claudeCode.useTerminal")).toBe(true);
        expect(keys.evaluate("config.terminal.integrated.hideOnLastClosed")).toBe(true);
        expect(keys.evaluate("config.terminal.integrated.tabs.location == right")).toBe(true);
        expect(keys.evaluate("!config.no.such.setting")).toBe(true);
        expect(keys.getRaw("config.claudeCode.useTerminal")).toBe(true);
        keys.dispose();
    });

    it("массив — JSON-строкой, объект — как есть (под in), null — нет значения", () => {
        const configuration = createTestConfigurationService({
            "demo.list": ["a", "b"],
            "demo.map": { java: true },
            "demo.nothing": null,
            "demo.count": 3,
        });
        const keys = new ContextKeyService(configuration);
        expect(keys.getRaw("config.demo.list")).toBe('["a","b"]');
        expect(keys.evaluate('config.demo.list =~ /"b"/')).toBe(true);
        keys.setRaw("lang", "java");
        expect(keys.evaluate("lang in config.demo.map")).toBe(true);
        expect(keys.getRaw("config.demo.nothing")).toBeUndefined();
        expect(keys.evaluate("config.demo.count > 2")).toBe(true);
        keys.dispose();
    });

    it("смена настройки сбрасывает прочитанное и сообщает onDidChange; непрочитанные — молча", async () => {
        const configuration = createTestConfigurationService({ "claudeCode.useTerminal": false });
        const keys = new ContextKeyService(configuration);
        const changes: string[][] = [];
        keys.onDidChange((names) => changes.push([...names]));
        expect(keys.evaluate("config.claudeCode.useTerminal")).toBe(false);

        await configuration.updateValue("claudeCode.useTerminal", true);
        await flush();
        expect(changes).toStrictEqual([["config.claudeCode.useTerminal"]]);
        expect(keys.evaluate("config.claudeCode.useTerminal")).toBe(true);

        // Чужая настройка прочитанный ключ не трогает.
        await configuration.updateValue("other.setting", 1);
        await flush();
        expect(changes).toHaveLength(1);
        keys.dispose();
    });

    it("прочитанное кэшируется: when на каждое нажатие не ходит в настройки повторно", () => {
        const configuration = createTestConfigurationService({ "demo.flag": true });
        const read = vi.spyOn(configuration, "getValue");
        const keys = new ContextKeyService(configuration);
        keys.evaluate("config.demo.flag");
        keys.evaluate("config.demo.flag && config.demo.flag");
        expect(read).toHaveBeenCalledTimes(1);
        keys.dispose();
    });

    it("смена родительской секции сбрасывает вложенный ключ", async () => {
        const configuration = createTestConfigurationService({ "demo.section": { flag: false } });
        const keys = new ContextKeyService(configuration);
        expect(keys.evaluate("config.demo.section.flag")).toBe(false);
        await configuration.updateValue("demo.section", { flag: true });
        expect(keys.evaluate("config.demo.section.flag")).toBe(true);
        keys.dispose();
    });

    it("запись в config.* не перебивает настройку; без настроек config.* — обычный ключ", () => {
        const keys = new ContextKeyService(createTestConfigurationService({ "demo.flag": false }));
        keys.setRaw("config.demo.flag", true);
        expect(keys.evaluate("config.demo.flag")).toBe(false);
        keys.dispose();

        const plain = new ContextKeyService();
        plain.setRaw("config.demo.flag", true);
        expect(plain.evaluate("config.demo.flag")).toBe(true);
        plain.dispose();
    });
});
