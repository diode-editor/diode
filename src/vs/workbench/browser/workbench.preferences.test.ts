import * as fs from "node:fs";
import * as path from "node:path";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { IEnvironmentServiceDIToken } from "../../platform/environment/common/environment.ts";
import type { KeybindingsEditorPane } from "../contrib/preferences/browser/keybindingsEditorPane.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

import { WorkbenchComponentDIToken } from "./workbenchComponent.ts";
import { WorkbenchContextKeysDIToken } from "./workbenchContextKeys.ts";

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
            // 120 columns: at the default 80, next to the sidebar, the keybindings tab
            // header is truncated ("Keybindi…").
            h = createAppTestHarness({
                environment: { settingsResource: settingsFile, keybindingsResource: keybindingsFile },
                size: new Size(120, 24),
            });
        });

        it("openSettings seeds a missing settings.json and opens it", async () => {
            await h.commands.execute("workbench.action.openSettings");

            expect(fs.readFileSync(settingsFile, "utf-8")).toBe("{}\n");
            expect(h.activeEditor().absoluteFilePath).toBe(path.resolve(settingsFile));
        });

        it("openSettingsJson (golang.go: 'Open Settings' in a toast) seeds a missing settings.json and opens it", async () => {
            await h.commands.execute("workbench.action.openSettingsJson");

            expect(fs.readFileSync(settingsFile, "utf-8")).toBe("{}\n");
            expect(h.activeEditor().absoluteFilePath).toBe(path.resolve(settingsFile));
            h.testApp.render();
            expect(h.testApp.backend.screenToString()).toContain("settings.json");
        });

        it("openGlobalKeybindingsFile seeds a missing keybindings.json and opens it", async () => {
            await h.commands.execute("workbench.action.openGlobalKeybindingsFile");

            expect(fs.readFileSync(keybindingsFile, "utf-8")).toBe("[]\n");
            expect(h.activeEditor().absoluteFilePath).toBe(path.resolve(keybindingsFile));
        });

        it("openGlobalKeybindings opens the Keyboard Shortcuts tab, not the JSON", () => {
            h.commands.execute("workbench.action.openGlobalKeybindings");

            const pane = h.container.get(EditorServiceDIToken).getActivePane();
            expect(pane).not.toBeNull();
            expect(pane!.uri.scheme).toBe("keybindings");
            expect(pane!.label).toBe("Keyboard Shortcuts");
            expect(fs.existsSync(keybindingsFile)).toBe(false);

            // The list is alphabetical and a specific binding may fall outside the viewport —
            // the Source column with default entries is enough.
            h.testApp.render();
            const screen = h.testApp.backend.screenToString();
            expect(screen).toContain("Keybinding");
            expect(screen).toContain("Source");
            expect(screen).toContain("Default");
        });

        it("a repeated openGlobalKeybindings switches to the open tab instead of opening a second one", () => {
            const editorService = h.container.get(EditorServiceDIToken);
            h.commands.execute("workbench.action.openGlobalKeybindings");
            const openedCount = editorService.editorGroups.activeGroup.getPanes().length;

            h.commands.execute("workbench.action.openGlobalKeybindings");

            expect(editorService.editorGroups.activeGroup.getPanes().length).toBe(openedCount);
        });

        it("does not overwrite an existing settings.json", async () => {
            fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
            fs.writeFileSync(settingsFile, '{ "editor.tabSize": 2 }\n', "utf-8");

            await h.commands.execute("workbench.action.openSettings");

            expect(fs.readFileSync(settingsFile, "utf-8")).toBe('{ "editor.tabSize": 2 }\n');
            expect(h.activeEditor().absoluteFilePath).toBe(path.resolve(settingsFile));
        });
    });

    describe("workspace settings.json", () => {
        it("openWorkspaceSettingsFile creates .diode/settings.json in the open folder from a template and opens it", async () => {
            ws = createTempWorkspace({ prefix: "diode-prefs-" });
            h = createAppTestHarness({ workspaceFolder: ws.dir });
            const file = ws.path(".diode/settings.json");

            await h.commands.execute("workbench.action.openWorkspaceSettingsFile");

            expect(fs.readFileSync(file, "utf-8")).toBe("{}\n");
            expect(h.activeEditor().absoluteFilePath).toBe(path.resolve(file));
        });

        it("openWorkspaceSettings opens the same JSON and does not overwrite an existing file", async () => {
            ws = createTempWorkspace({
                prefix: "diode-prefs-",
                files: { ".diode/settings.json": '{ "editor.tabSize": 2 }\n' },
            });
            h = createAppTestHarness({ workspaceFolder: ws.dir });

            await h.commands.execute("workbench.action.openWorkspaceSettings");

            expect(fs.readFileSync(ws.path(".diode/settings.json"), "utf-8")).toBe('{ "editor.tabSize": 2 }\n');
            expect(h.activeEditor().absoluteFilePath).toBe(path.resolve(ws.path(".diode/settings.json")));
        });

        it("without a folder the workspace commands are not in the command palette, and invoking them by id creates no files", async () => {
            ws = createTempWorkspace({ prefix: "diode-prefs-" });
            h = createAppTestHarness({});
            const contextKeys = h.container.get(ContextKeyServiceDIToken);
            const titles = (): string[] => h.commands.listCommands().map((command) => command.title);
            h.container.get(WorkbenchContextKeysDIToken).update();
            const enabled = h.commands
                .listCommands()
                .filter((command) => command.id.startsWith("workbench.action.openWorkspaceSettings"))
                .filter((command) => command.enablement === undefined || contextKeys.evaluate(command.enablement));
            expect(enabled).toEqual([]);
            expect(titles()).toContain("Preferences: Open Workspace Settings (JSON)");

            await h.commands.execute("workbench.action.openWorkspaceSettingsFile");
            expect(fs.readdirSync(ws.dir)).toEqual([]);
        });
    });

    describe("window from a .code-workspace", () => {
        const WORKSPACE_FILE_TEXT = '{ "folders": [{ "path": "." }], "settings": {} }\n';

        function openWorkspaceFile(): string {
            ws = createTempWorkspace({ prefix: "diode-prefs-", files: { "web.code-workspace": WORKSPACE_FILE_TEXT } });
            h = createAppTestHarness({});
            const file = ws.path("web.code-workspace");
            h.container
                .get(WorkbenchComponentDIToken)
                .openWorkspaceFile(file, { folder: ws.dir, folderName: undefined });
            h.container.get(WorkbenchContextKeysDIToken).update();
            return file;
        }

        function enabledIds(prefix: string): string[] {
            const contextKeys = h.container.get(ContextKeyServiceDIToken);
            return h.commands
                .listCommands()
                .filter((command) => command.id.startsWith(prefix))
                .filter((command) => command.enablement === undefined || contextKeys.evaluate(command.enablement))
                .map((command) => command.id);
        }

        // As upstream: the workspace settings of such a window are the file's `settings` block.
        it("Open Workspace Settings opens the workspace file itself and leaves it untouched", async () => {
            const file = openWorkspaceFile();

            await h.commands.execute("workbench.action.openWorkspaceSettings");

            expect(h.activeEditor().absoluteFilePath).toBe(path.resolve(file));
            expect(fs.readFileSync(file, "utf-8")).toBe(WORKSPACE_FILE_TEXT);
            expect(fs.existsSync(ws.path(".diode"))).toBe(false);
        });

        it("Open Folder Settings (JSON) creates the folder's .diode/settings.json from a template; it is in the command palette only here", async () => {
            openWorkspaceFile();
            expect(enabledIds("workbench.action.openFolderSettings")).toEqual([
                "workbench.action.openFolderSettings",
                "workbench.action.openFolderSettingsFile",
            ]);

            await h.commands.execute("workbench.action.openFolderSettingsFile");

            expect(fs.readFileSync(ws.path(".diode/settings.json"), "utf-8")).toBe("{}\n");
            expect(h.activeEditor().absoluteFilePath).toBe(path.resolve(ws.path(".diode/settings.json")));
        });

        it("in a folder window the folder settings commands are not in the command palette", () => {
            ws = createTempWorkspace({ prefix: "diode-prefs-" });
            h = createAppTestHarness({ workspaceFolder: ws.dir });
            h.container.get(WorkbenchContextKeysDIToken).update();
            expect(enabledIds("workbench.action.openFolderSettings")).toEqual([]);
        });
    });

    describe("recording a keybinding from the tab, end to end", () => {
        let keybindingsFile: string;

        beforeEach(() => {
            ws = createTempWorkspace({ prefix: "diode-prefs-" });
            keybindingsFile = ws.path("user-data/User/keybindings.json");
            h = createAppTestHarness({ environment: { keybindingsResource: keybindingsFile } });
        });

        it("the recorder writes the combination: file on disk, row updated, the command works at once", async () => {
            const executed: string[] = [];
            h.commands.register(
                "test.custom",
                () => {
                    executed.push("test.custom");
                },
                "Recorder Target",
            );

            h.commands.execute("workbench.action.openGlobalKeybindings");
            h.testApp.render();
            const pane = h.container.get(EditorServiceDIToken).getActivePane()!;
            expect(pane.uri.scheme).toBe("keybindings");

            const rows = pane.view.querySelectorAll("TextLabelElement");
            const row = rows.find((r) =>
                (r as unknown as { getText(): string }).getText().startsWith("Recorder Target"),
            )!;
            const list = pane.view.querySelector("#keybindingsList")!;
            (list as unknown as { onActivate: ((el: unknown) => void) | null }).onActivate?.(row);
            h.testApp.render();
            expect(h.testApp.backend.screenToString()).toContain("Press desired key combination");

            const executeSpy = vi.spyOn(h.commands, "execute");
            h.testApp.sendKey("Ctrl+S");
            expect(executeSpy).not.toHaveBeenCalledWith("workbench.action.files.save");
            h.testApp.sendKey("Escape");
            (list as unknown as { onActivate: ((el: unknown) => void) | null }).onActivate?.(row);
            h.testApp.sendKey("F6");
            h.testApp.sendKey("Enter");

            // The write is async: under run load (8 workers, coverage/Stryker) it does not
            // fit into the default one second of `vi.waitFor`.
            await vi.waitFor(
                () => {
                    expect(fs.existsSync(keybindingsFile)).toBe(true);
                    expect(fs.readFileSync(keybindingsFile, "utf-8")).toContain('"key": "f6"');
                },
                { timeout: 5000 },
            );
            expect(fs.readFileSync(keybindingsFile, "utf-8")).toContain('"command": "test.custom"');

            // The filter brings the row into the viewport. Wait for the frame itself: the registry
            // update lags behind the disk write on a loaded machine (red CI, Stryker's dry run).
            (pane as KeybindingsEditorPane).setFilter("Recorder Target");
            await vi.waitFor(
                () => {
                    h.testApp.render();
                    const screen = h.testApp.backend.screenToString();
                    expect(screen).toContain("Recorder Target");
                    expect(screen).toContain("F6");
                },
                { timeout: 5000 },
            );
            // …and the command runs on the new combination in the same session (lesson #194).
            h.testApp.sendKey("F6");
            expect(executed).toEqual(["test.custom"]);
        }, 15_000);
    });

    describe("default harness — test environment", () => {
        beforeEach(() => {
            ws = createTempWorkspace({ prefix: "diode-prefs-" });
            h = createAppTestHarness();
        });

        it("openSettings opens settings.json of the test environment (a fresh temp dir per container)", async () => {
            const { settingsResource, userDataRoot } = h.container.get(IEnvironmentServiceDIToken);
            expect(settingsResource.startsWith(userDataRoot)).toBe(true);

            await h.commands.execute("workbench.action.openSettings");

            expect(fs.readFileSync(settingsResource, "utf-8")).toBe("{}\n");
            expect(h.activeEditor().absoluteFilePath).toBe(path.resolve(settingsResource));
        });
    });
});
