import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { KeybindingsEditorPane } from "../contrib/preferences/browser/keybindingsEditorPane.ts";
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

        it("openGlobalKeybindingsFile seeds a missing keybindings.json and opens it", () => {
            h.commands.execute("workbench.action.openGlobalKeybindingsFile");

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

            // Вкладка обязана дойти до кадра: шапка колонок и настоящие строки
            // биндингов (список алфавитный, конкретный бинд может не попасть в
            // видимое окно — достаточно колонки Source с дефолтными записями).
            h.testApp.render();
            const screen = h.testApp.backend.screenToString();
            expect(screen).toContain("Keybinding");
            expect(screen).toContain("Source");
            expect(screen).toContain("Default");
        });

        it("повторное openGlobalKeybindings переключает на открытую вкладку, а не плодит вторую", () => {
            const editorService = h.container.get(EditorServiceDIToken);
            h.commands.execute("workbench.action.openGlobalKeybindings");
            const openedCount = editorService.getPanes().length;

            h.commands.execute("workbench.action.openGlobalKeybindings");

            expect(editorService.getPanes().length).toBe(openedCount);
        });

        it("does not overwrite an existing settings.json", () => {
            fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
            fs.writeFileSync(settingsFile, '{ "editor.tabSize": 2 }\n', "utf-8");

            h.commands.execute("workbench.action.openSettings");

            expect(fs.readFileSync(settingsFile, "utf-8")).toBe('{ "editor.tabSize": 2 }\n');
            expect(h.activeEditor().absoluteFilePath).toBe(path.resolve(settingsFile));
        });
    });

    describe("запись биндинга из вкладки — сквозной путь", () => {
        let keybindingsFile: string;

        beforeEach(() => {
            ws = createTempWorkspace({ prefix: "diode-prefs-" });
            keybindingsFile = ws.path("user-data/User/keybindings.json");
            h = createAppTestHarness({ keybindingsResource: keybindingsFile });
        });

        it("рекордер пишет комбинацию: файл на диске, строка обновилась, команда работает сразу", async () => {
            const executed: string[] = [];
            h.commands.register("test.custom", () => {
                executed.push("test.custom");
            }, "Recorder Target");

            h.commands.execute("workbench.action.openGlobalKeybindings");
            h.testApp.render();
            const pane = h.container.get(EditorServiceDIToken).getActivePane()!;
            expect(pane.uri.scheme).toBe("keybindings");

            // Активируем строку команды (Enter/двойной клик) → рекордер.
            const rows = pane.view.querySelectorAll("TextLabelElement");
            const row = rows.find((r) => (r as unknown as { getText(): string }).getText().startsWith("Recorder Target"))!;
            const list = pane.view.querySelector("#keybindingsList")!;
            (list as unknown as { onActivate: ((el: unknown) => void) | null }).onActivate?.(row);
            h.testApp.render();
            expect(h.testApp.backend.screenToString()).toContain("Press desired key combination");

            // Клавиши в рекордере копятся, а не исполняются: Ctrl+S не сохраняет.
            const executeSpy = vi.spyOn(h.commands, "execute");
            h.testApp.sendKey("Ctrl+S");
            expect(executeSpy).not.toHaveBeenCalledWith("workbench.action.files.save");
            // Передумали: сотрём попытку отменой нельзя — просто примем F6 новой записью.
            h.testApp.sendKey("Escape");
            (list as unknown as { onActivate: ((el: unknown) => void) | null }).onActivate?.(row);
            h.testApp.sendKey("F6");
            h.testApp.sendKey("Enter");

            await vi.waitFor(() => {
                expect(fs.existsSync(keybindingsFile)).toBe(true);
                expect(fs.readFileSync(keybindingsFile, "utf-8")).toContain('"key": "f6"');
            });
            expect(fs.readFileSync(keybindingsFile, "utf-8")).toContain('"command": "test.custom"');

            // Строка вкладки обновилась (фильтр — чтобы строка попала в видимое окно)…
            (pane as KeybindingsEditorPane).setFilter("Recorder Target");
            h.testApp.render();
            const screen = h.testApp.backend.screenToString();
            expect(screen).toContain("Recorder Target");
            expect(screen).toContain("F6");
            // …и команда исполняется по новой комбинации в том же сеансе (урок #194).
            h.testApp.sendKey("F6");
            expect(executed).toEqual(["test.custom"]);
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
