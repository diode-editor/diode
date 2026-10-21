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

describe("ConfigurationSnapshot — values for a language", () => {
    it("language section on top of the main value; another language does not see it", () => {
        const s = snapshot({ "[makefile]": { "editor.insertSpaces": false } });

        expect(s.model().get("editor.insertSpaces")).toBe(true);
        expect(s.model({ overrideIdentifier: "makefile" }).get("editor.insertSpaces")).toBe(false);
        expect(s.model({ overrideIdentifier: "go" }).get("editor.insertSpaces")).toBe(true);
        // A repeated read returns the same (cached) model.
        expect(s.model({ overrideIdentifier: "makefile" })).toBe(s.model({ overrideIdentifier: "makefile" }));
    });

    it("core key that is not language-overridable is ignored in a section; an extension key applies", () => {
        const s = snapshot({ "[python]": { "files.autoSave": "afterDelay", "ruff.lint.enable": false } });
        const python = s.model({ overrideIdentifier: "python" });

        expect(python.get("files.autoSave")).toBe("off");
        expect(python.get("ruff.lint.enable")).toBe(false);
    });

    it("only the disallowed key itself is removed from the section; sibling keys with the same prefix stay", () => {
        const s = snapshot({ "[python]": { "files.autoSave": "afterDelay", "files.trimTrailingWhitespace": true } });
        const python = s.model({ overrideIdentifier: "python" });

        expect(python.get("files.autoSave")).toBe("off");
        expect(python.get("files.trimTrailingWhitespace")).toBe(true);
    });

    it("prefix of a disallowed key in the section is not an object: no crash", () => {
        const s = snapshot({ "[python]": { files: null, "editor.tabSize": 2 } });

        expect(s.model({ overrideIdentifier: "python" }).get("editor.tabSize")).toBe(2);
    });

    it("section value is validated against the schema too: garbage becomes the default", () => {
        const s = snapshot({ "editor.tabSize": 2, "[go]": { "editor.tabSize": 0 } });

        expect(s.model({ overrideIdentifier: "go" }).get("editor.tabSize")).toBe(4);
    });
});

describe("ConfigurationSnapshot — change event", () => {
    it("nothing changed — null", () => {
        expect(snapshot({ "editor.tabSize": 2 }).changeFrom(snapshot({ "editor.tabSize": 2 }))).toBeNull();
    });

    it("editing only a language section — key in affectedKeys and language in overrideIdentifiers", () => {
        const event = snapshot({ "[go]": { "editor.tabSize": 8 } }).changeFrom(
            snapshot({ "[go]": { "editor.tabSize": 4 } }),
        );

        expect(event?.affectedKeys).toEqual(["editor.tabSize"]);
        expect(event?.overrideIdentifiers).toEqual(["go"]);
        expect(event?.affectsConfiguration("editor")).toBe(true);
    });

    it("in-memory service: writing a language section fires an event with the language and changes reads for it", async () => {
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
