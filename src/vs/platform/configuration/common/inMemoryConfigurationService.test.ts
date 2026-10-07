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

    it("без реестра дефолтов нет", () => {
        expect(new InMemoryConfigurationService().get("editor.tabSize")).toBeUndefined();
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

    it("getConfigurationData — дефолты реестра и user-слой", () => {
        const service = new InMemoryConfigurationService(registry(), { "editor.tabSize": 2 });

        expect(service.getConfigurationData()).toEqual({
            defaults: { editor: { tabSize: 4 }, files: { exclude: { "**/.git": true } } },
            user: { editor: { tabSize: 2 } },
            workspace: {},
        });
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
        expect(NULL_CONFIGURATION_SERVICE.getConfigurationData()).toEqual({ defaults: {}, user: {}, workspace: {} });
        expect(NULL_CONFIGURATION_SERVICE.inspect("editor.tabSize")).toStrictEqual({
            default: undefined,
            user: undefined,
            profile: undefined,
            workspace: undefined,
            value: undefined,
        });
        expect(NULL_CONFIGURATION_SERVICE.get("editor.tabSize")).toBeUndefined();
    });
});

describe("InMemoryConfigurationService — слой воркспейса", () => {
    function scopedRegistry(): ConfigurationRegistry {
        const r = registry();
        r.registerConfiguration({
            id: "machine",
            properties: { "terminal.tier": { scope: "machine", type: "string", default: "auto" } },
        });
        return r;
    }

    it("переданный слой — поверх user, отфильтрован по scope, виден в inspect и данных хоста", () => {
        const service = new InMemoryConfigurationService(
            scopedRegistry(),
            { "editor.tabSize": 2 },
            { "editor.tabSize": 8, "terminal.tier": "kitty" },
        );

        expect(service.get("editor.tabSize")).toBe(8);
        expect(service.get("terminal.tier")).toBe("auto");
        expect(service.inspect("editor.tabSize")).toEqual({
            default: 4,
            user: 2,
            profile: undefined,
            workspace: 8,
            value: 8,
        });
        expect(service.getConfigurationData().workspace).toEqual({ editor: { tabSize: 8 } });
    });

    it("запись в воркспейс: значение, событие, undefined снимает ключ", async () => {
        const service = new InMemoryConfigurationService(scopedRegistry(), {}, {});
        const seen: string[][] = [];
        service.onDidChangeConfiguration((e) => seen.push([...e.affectedKeys]));

        await service.updateValue("editor.tabSize", 8, "workspace");
        expect(service.inspect("editor.tabSize").workspace).toBe(8);
        expect(service.inspect("editor.tabSize").user).toBeUndefined();

        await service.updateValue("editor.tabSize", undefined, "workspace");
        expect(service.get("editor.tabSize")).toBe(4);
        expect(seen).toEqual([["editor.tabSize"], ["editor.tabSize"]]);
    });

    it("undefined снимает ключ и в user-слое", async () => {
        const service = new InMemoryConfigurationService(registry(), { "editor.tabSize": 2 });
        await service.updateValue("editor.tabSize", undefined);
        expect(service.inspect("editor.tabSize").user).toBeUndefined();
        expect(service.getConfigurationData().user).toEqual({});
    });

    it("отказы — как у файловой реализации: без папки и ключ чужого scope", async () => {
        await expect(
            new InMemoryConfigurationService(scopedRegistry()).updateValue("editor.tabSize", 8, "workspace"),
        ).rejects.toThrow("no workspace is opened");

        const withFolder = new InMemoryConfigurationService(scopedRegistry(), {}, {});
        await expect(withFolder.updateValue("terminal.tier", "kitty", "workspace")).rejects.toThrow(
            "Unable to write terminal.tier to Workspace Settings. This setting can be written only into User settings.",
        );
        expect(withFolder.getConfigurationData().workspace).toEqual({});
    });
});
