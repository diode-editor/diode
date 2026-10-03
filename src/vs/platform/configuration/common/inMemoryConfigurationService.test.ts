import { describe, expect, it } from "vitest";

import type { IConfigurationNode } from "./configurationRegistry.ts";
import { ConfigurationRegistry } from "./configurationRegistry.ts";
import type { IConfigurationChangeEvent } from "./iConfigurationService.ts";
import { InMemoryConfigurationService } from "./inMemoryConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "./nullConfigurationService.ts";

const editorNode: IConfigurationNode = {
    id: "editor",
    properties: {
        "editor.tabSize": { scope: "language-overridable", type: "number", default: 4 },
        "files.exclude": { scope: "resource", type: "object", default: { "**/.git": true } },
    },
};

function registry(): ConfigurationRegistry {
    return new ConfigurationRegistry([editorNode]);
}

describe("InMemoryConfigurationService", () => {
    it("отвечает дефолтами реестра, а не undefined", () => {
        const service = new InMemoryConfigurationService(registry());

        expect(service.get("editor.tabSize")).toBe(4);
        expect(service.inspect("editor.tabSize")).toEqual({
            default: 4,
            user: undefined,
            profile: undefined,
            value: 4,
        });
        expect(service.getValue("editor")).toEqual({ tabSize: 4 });
    });

    it("без реестра дефолтов нет — работает defaultValue", () => {
        const service = new InMemoryConfigurationService();

        expect(service.get("editor.tabSize")).toBeUndefined();
        expect(service.get("editor.tabSize", 8)).toBe(8);
    });

    it("начальные значения ложатся в user-слой поверх дефолтов", () => {
        const service = new InMemoryConfigurationService(registry(), { "editor.tabSize": 2 });

        expect(service.get("editor.tabSize")).toBe(2);
        expect(service.inspect("editor.tabSize")).toEqual({ default: 4, user: 2, profile: undefined, value: 2 });
    });

    it("updateValue пишет в user-слой и эмитит событие с изменившимся ключом", async () => {
        const service = new InMemoryConfigurationService(registry());
        const events: IConfigurationChangeEvent[] = [];
        service.onDidChangeConfiguration((event) => events.push(event));

        await service.updateValue("editor.tabSize", 2);

        expect(service.get("editor.tabSize")).toBe(2);
        expect(service.inspect("editor.tabSize").user).toBe(2);
        expect(events.map((e) => e.affectedKeys)).toEqual([["editor.tabSize"]]);
        expect(events[0].affectsConfiguration("editor")).toBe(true);
    });

    it("запись того же значения события не порождает", async () => {
        const service = new InMemoryConfigurationService(registry());
        const events: IConfigurationChangeEvent[] = [];
        service.onDidChangeConfiguration((event) => events.push(event));

        await service.updateValue("editor.tabSize", 4);

        expect(events).toEqual([]);
    });

    it("объект заменяется целиком, как в settings.json, а не сливается с прежним", async () => {
        const service = new InMemoryConfigurationService(registry(), { "files.exclude": { "**/a": true } });

        await service.updateValue("files.exclude", { "**/b": true });

        // Дефолт реестра под пользовательским объектом по-прежнему виден (слои
        // сливаются), но прежнее пользовательское значение заменено.
        expect(service.inspect("files.exclude").user).toEqual({ "**/b": true });
    });

    it("отписка снимает слушателя", async () => {
        const service = new InMemoryConfigurationService(registry());
        let fired = 0;
        const subscription = service.onDidChangeConfiguration(() => {
            fired++;
        });

        subscription.dispose();
        await service.updateValue("editor.tabSize", 2);

        expect(fired).toBe(0);
    });
});

describe("NULL_CONFIGURATION_SERVICE", () => {
    it("запись — честный отказ, а не молчаливый no-op", async () => {
        await expect(NULL_CONFIGURATION_SERVICE.updateValue("editor.tabSize", 2)).rejects.toThrow(/read-only/);
        expect(NULL_CONFIGURATION_SERVICE.get("editor.tabSize")).toBeUndefined();
    });
});
