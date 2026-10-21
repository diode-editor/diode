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
    it("returns registry defaults, not undefined", () => {
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

    it("no registry — no defaults", () => {
        expect(new InMemoryConfigurationService().get("editor.tabSize")).toBeUndefined();
    });

    it("initial values go into the user layer on top of defaults", () => {
        const service = new InMemoryConfigurationService(registry(), { "editor.tabSize": 2 });

        expect(service.get("editor.tabSize")).toBe(2);
        expect(service.inspect("editor.tabSize")).toEqual({ default: 4, user: 2, profile: undefined, value: 2 });
    });

    it("updateValue writes to the user layer and fires an event with the changed key", async () => {
        const service = new InMemoryConfigurationService(registry());
        const events: IConfigurationChangeEvent[] = [];
        service.onDidChangeConfiguration((event) => events.push(event));

        await service.updateValue("editor.tabSize", 2);

        expect(service.get("editor.tabSize")).toBe(2);
        expect(service.inspect("editor.tabSize").user).toBe(2);
        expect(events.map((e) => e.affectedKeys)).toEqual([["editor.tabSize"]]);
        expect(events[0].affectsConfiguration("editor")).toBe(true);
    });

    it("writing the same value fires no event", async () => {
        const service = new InMemoryConfigurationService(registry());
        const events: IConfigurationChangeEvent[] = [];
        service.onDidChangeConfiguration((event) => events.push(event));

        await service.updateValue("editor.tabSize", 4);

        expect(events).toEqual([]);
    });

    it("an object is replaced as a whole, as in settings.json, not merged with the previous one", async () => {
        const service = new InMemoryConfigurationService(registry(), { "files.exclude": { "**/a": true } });

        await service.updateValue("files.exclude", { "**/b": true });

        // The registry default under the user object is still visible (layers
        // merge), but the previous user value is replaced.
        expect(service.inspect("files.exclude").user).toEqual({ "**/b": true });
    });

    it("getConfigurationData — registry defaults and the user layer", () => {
        const service = new InMemoryConfigurationService(registry(), { "editor.tabSize": 2 });

        expect(service.getConfigurationData()).toEqual({
            defaults: { editor: { tabSize: 4 }, files: { exclude: { "**/.git": true } } },
            user: { editor: { tabSize: 2 } },
            workspace: {},
            workspaceFolder: {},
        });
    });

    it("unsubscribing removes the listener", async () => {
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
    it("write is an explicit rejection, not a silent no-op", async () => {
        await expect(NULL_CONFIGURATION_SERVICE.updateValue("editor.tabSize", 2)).rejects.toThrow(/read-only/);
        expect(NULL_CONFIGURATION_SERVICE.getConfigurationData()).toEqual({
            defaults: {},
            user: {},
            workspace: {},
            workspaceFolder: {},
        });
        expect(NULL_CONFIGURATION_SERVICE.inspect("editor.tabSize")).toStrictEqual({
            default: undefined,
            user: undefined,
            profile: undefined,
            workspace: undefined,
            workspaceFolder: undefined,
            value: undefined,
        });
        expect(NULL_CONFIGURATION_SERVICE.get("editor.tabSize")).toBeUndefined();
    });
});

describe("InMemoryConfigurationService — workspace layer", () => {
    function scopedRegistry(): ConfigurationRegistry {
        const r = registry();
        r.registerConfiguration({
            id: "machine",
            properties: { "terminal.tier": { scope: "machine", type: "string", default: "auto" } },
        });
        return r;
    }

    it("given layer is on top of user, filtered by scope, visible in inspect and host data", () => {
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

    it("writing to the workspace: value, event, undefined removes the key", async () => {
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

    it("undefined removes the key in the user layer too", async () => {
        const service = new InMemoryConfigurationService(registry(), { "editor.tabSize": 2 });
        await service.updateValue("editor.tabSize", undefined);
        expect(service.inspect("editor.tabSize").user).toBeUndefined();
        expect(service.getConfigurationData().user).toEqual({});
    });

    it("rejections match the file-based implementation: no folder and a key of a foreign scope", async () => {
        await expect(
            new InMemoryConfigurationService(scopedRegistry()).updateValue("editor.tabSize", 8, "workspace"),
        ).rejects.toThrow("no workspace is opened");

        const withFolder = new InMemoryConfigurationService(scopedRegistry(), {}, {});
        await expect(withFolder.updateValue("terminal.tier", "kitty", "workspace")).rejects.toThrow(
            "Unable to write terminal.tier to Workspace Settings. This setting can be written only into User settings.",
        );
        expect(withFolder.getConfigurationData().workspace).toEqual({});
    });

    it("workspaceFolder target — the same workspace layer, rejected by folder scope", async () => {
        const service = new InMemoryConfigurationService(scopedRegistry(), {}, {});

        await service.updateValue("editor.tabSize", 6, "workspaceFolder");
        expect(service.inspect("editor.tabSize")).toMatchObject({ workspace: 6, workspaceFolder: undefined });

        await expect(service.updateValue("terminal.tier", "kitty", "workspaceFolder")).rejects.toThrow(
            "Unable to write to Folder Settings because terminal.tier does not support the folder resource scope.",
        );
        await expect(
            new InMemoryConfigurationService(scopedRegistry()).updateValue("editor.tabSize", 8, "workspaceFolder"),
        ).rejects.toThrow("no workspace is opened");
    });
});
