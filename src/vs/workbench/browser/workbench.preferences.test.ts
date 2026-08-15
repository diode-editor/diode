import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { EditorServiceDIToken } from "../services/editor/browser/editorService.ts";

describe("Workbench — Preferences commands", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    describe("with resolved user-config paths", () => {
        let settingsFile: string;
        let keybindingsFile: string;

        beforeEach(() => {
            ws = createTempWorkspace({ prefix: "diode-prefs-" });
            // Nested, not-yet-existing paths — the handler must create the parent dir + file.
            settingsFile = ws.path("user-data/User/settings.json");
            keybindingsFile = ws.path("user-data/User/keybindings.json");
            h = createAppTestHarness({ settingsResource: settingsFile, keybindingsResource: keybindingsFile });
        });

        it("openSettings seeds a missing settings.json and opens it", () => {
            h.commands.execute("workbench.action.openSettings");

            expect(fs.readFileSync(settingsFile, "utf-8")).toBe("{}\n");
            expect(h.activeEditor().absoluteFilePath).toBe(path.resolve(settingsFile));
        });

        it("openGlobalKeybindings seeds a missing keybindings.json and opens it", () => {
            h.commands.execute("workbench.action.openGlobalKeybindings");

            expect(fs.readFileSync(keybindingsFile, "utf-8")).toBe("[]\n");
            expect(h.activeEditor().absoluteFilePath).toBe(path.resolve(keybindingsFile));
        });

        it("does not overwrite an existing settings.json", () => {
            fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
            fs.writeFileSync(settingsFile, '{ "editor.tabSize": 2 }\n', "utf-8");

            h.commands.execute("workbench.action.openSettings");

            expect(fs.readFileSync(settingsFile, "utf-8")).toBe('{ "editor.tabSize": 2 }\n');
            expect(h.activeEditor().absoluteFilePath).toBe(path.resolve(settingsFile));
        });
    });

    describe("without resolved paths (default harness)", () => {
        beforeEach(() => {
            ws = createTempWorkspace({ prefix: "diode-prefs-" });
            h = createAppTestHarness();
        });

        it("openSettings is a no-op when the settings path is unknown", () => {
            expect(() => h.commands.execute("workbench.action.openSettings")).not.toThrow();
            expect(h.container.get(EditorServiceDIToken).getActiveEditor()).toBeNull();
        });
    });
});
