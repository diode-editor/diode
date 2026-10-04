import { describe, expect, it } from "vitest";

import { ConfigurationModel } from "./configurationModel.ts";
import { ConfigurationRegistry } from "./configurationRegistry.ts";
import { ConfigurationSnapshot } from "./configurationSnapshot.ts";
import type { IConfigurationChangeEvent } from "./iConfigurationService.ts";
import { InMemoryConfigurationService } from "./inMemoryConfigurationService.ts";

const registry = new ConfigurationRegistry([
    {
        id: "editor",
        properties: {
            "editor.tabSize": { scope: "language-overridable", type: "number", default: 4, minimum: 1 },
            "editor.insertSpaces": { scope: "language-overridable", type: "boolean", default: true },
            "files.autoSave": { scope: "resource", type: "string", default: "off" },
        },
    },
]);

function snapshot(settings: Record<string, unknown>): ConfigurationSnapshot {
    return new ConfigurationSnapshot(
        ConfigurationModel.merge(
            ConfigurationModel.fromRaw(registry.getDefaultConfiguration()),
            ConfigurationModel.fromRaw(settings),
        ),
        registry.getConfigurationProperties(),
    );
}

describe("ConfigurationSnapshot — значения для языка", () => {
    it("секция языка поверх основного значения; другой язык — без неё", () => {
        const s = snapshot({ "[makefile]": { "editor.insertSpaces": false } });

        expect(s.model().get("editor.insertSpaces")).toBe(true);
        expect(s.model({ overrideIdentifier: "makefile" }).get("editor.insertSpaces")).toBe(false);
        expect(s.model({ overrideIdentifier: "go" }).get("editor.insertSpaces")).toBe(true);
        // Повторное чтение — та же модель (кэш).
        expect(s.model({ overrideIdentifier: "makefile" })).toBe(s.model({ overrideIdentifier: "makefile" }));
    });

    it("ключ ядра не language-overridable в секции игнорируется; ключ расширения — действует", () => {
        const s = snapshot({ "[python]": { "files.autoSave": "afterDelay", "ruff.lint.enable": false } });
        const python = s.model({ overrideIdentifier: "python" });

        expect(python.get("files.autoSave")).toBe("off");
        expect(python.get("ruff.lint.enable")).toBe(false);
    });

    it("из секции уходит только сам неразрешённый ключ, соседние ключи того же префикса остаются", () => {
        const s = snapshot({ "[python]": { "files.autoSave": "afterDelay", "files.trimTrailingWhitespace": true } });
        const python = s.model({ overrideIdentifier: "python" });

        expect(python.get("files.autoSave")).toBe("off");
        expect(python.get("files.trimTrailingWhitespace")).toBe(true);
    });

    it("префикс неразрешённого ключа в секции — не объект: не падаем", () => {
        const s = snapshot({ "[python]": { files: null, "editor.tabSize": 2 } });

        expect(s.model({ overrideIdentifier: "python" }).get("editor.tabSize")).toBe(2);
    });

    it("значение секции тоже проходит схему: мусор — дефолт", () => {
        const s = snapshot({ "editor.tabSize": 2, "[go]": { "editor.tabSize": 0 } });

        expect(s.model({ overrideIdentifier: "go" }).get("editor.tabSize")).toBe(4);
    });
});

describe("ConfigurationSnapshot — событие изменения", () => {
    it("ничего не поменялось — null", () => {
        expect(snapshot({ "editor.tabSize": 2 }).changeFrom(snapshot({ "editor.tabSize": 2 }))).toBeNull();
    });

    it("правка только секции языка — ключ в affectedKeys и язык в overrideIdentifiers", () => {
        const event = snapshot({ "[go]": { "editor.tabSize": 8 } }).changeFrom(
            snapshot({ "[go]": { "editor.tabSize": 4 } }),
        );

        expect(event?.affectedKeys).toEqual(["editor.tabSize"]);
        expect(event?.overrideIdentifiers).toEqual(["go"]);
        expect(event?.affectsConfiguration("editor")).toBe(true);
    });

    it("сервис в памяти: запись секции языка эмитит событие с языком и меняет чтение для языка", async () => {
        const service = new InMemoryConfigurationService(registry);
        const events: IConfigurationChangeEvent[] = [];
        service.onDidChangeConfiguration((e) => events.push(e));

        await service.updateValue("[go]", { "editor.insertSpaces": false });

        expect(events.map((e) => e.overrideIdentifiers)).toEqual([["go"]]);
        expect(service.get("editor.insertSpaces", { overrideIdentifier: "go" })).toBe(false);
        expect(service.inspect("editor.insertSpaces", { overrideIdentifier: "go" }).value).toBe(false);
        expect(service.getConfigurationData().user).toEqual({ "[go]": { editor: { insertSpaces: false } } });
    });
});
