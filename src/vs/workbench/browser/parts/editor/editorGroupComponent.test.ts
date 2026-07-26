import * as fs from "node:fs";
import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { EditorService } from "../../../services/editor/browser/editorService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../../services/themes/common/themeService.ts";

import { EditorGroupComponent } from "./editorGroupComponent.ts";

interface IEditorGroup {
    service: EditorService;
    component: EditorGroupComponent;
}

function createEditorGroup(
    overrides: {
        languageService?: ILanguageService;
        themeService?: ThemeService;
    } = {},
): IEditorGroup {
    const themeService = overrides.themeService ?? new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
    const service = new EditorService(
        themeService,
        new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        overrides.languageService ?? NULL_LANGUAGE_SERVICE,
        NULL_CONFIGURATION_SERVICE,
        new UndoRedoService(),
        NULL_FILE_WATCHER,
        createTestEditorContextMenuController(),
    );
    const component = new EditorGroupComponent(service, themeService);
    return { service, component };
}

function tabLabels(component: EditorGroupComponent): string[] {
    return component.view.tabStrip.getItemElements().map((item) => item.getLabel());
}

describe("EditorGroupComponent", () => {
    let tmpDir: string;
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "vexx-test-" });
        tmpDir = ws.dir;
    });

    afterEach(() => {
        ws.dispose();
    });

    function writeFile(name: string, content: string): string {
        const filePath = path.join(tmpDir, name);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content, "utf-8");
        return filePath;
    }

    describe("tab labels", () => {
        it("disambiguates tabs by parent directory when names collide", () => {
            const { service, component } = createEditorGroup();

            service.openFile(writeFile("standalone.ts", "s"));
            expect(tabLabels(component)).toEqual(["standalone.ts"]);

            service.openFile(writeFile(path.join("a", "index.ts"), "a"));
            service.openFile(writeFile(path.join("b", "index.ts"), "b"));

            expect(tabLabels(component)).toEqual(["standalone.ts", "index.ts — a", "index.ts — b"]);
        });

        it("disambiguates same-named files while untitled buffers keep their own labels", () => {
            // Смешанный случай: безымянные буферы не участвуют в разводке тёзок (их метки
            // уникальны по построению), а их uri не file — путь у них брать нельзя.
            const { service, component } = createEditorGroup();

            service.newUntitled();
            service.openFile(writeFile(path.join("a", "index.ts"), "a"));
            service.newUntitled();
            service.openFile(writeFile(path.join("b", "index.ts"), "b"));

            expect(tabLabels(component)).toEqual(["Untitled-1", "index.ts — a", "Untitled-2", "index.ts — b"]);
        });

        it("extends the disambiguating suffix when parent directories also collide", () => {
            const { service, component } = createEditorGroup();

            service.openFile(writeFile(path.join("x", "common", "index.ts"), "x"));
            service.openFile(writeFile(path.join("y", "common", "index.ts"), "y"));

            const sep = path.sep;
            expect(tabLabels(component)).toEqual([`index.ts — x${sep}common`, `index.ts — y${sep}common`]);
        });

        it("labels untitled buffers Untitled-N, incrementing per buffer", () => {
            const { service, component } = createEditorGroup();

            service.newUntitled();
            expect(tabLabels(component)).toEqual(["Untitled-1"]);

            service.newUntitled();
            expect(tabLabels(component)).toEqual(["Untitled-1", "Untitled-2"]);
        });

        it("does not reuse a number after an untitled buffer is closed", () => {
            const { service, component } = createEditorGroup();

            service.newUntitled();
            service.newUntitled();
            service.closeTab(0);
            service.newUntitled();

            expect(tabLabels(component)).toEqual(["Untitled-2", "Untitled-3"]);
        });

        it("relabels to the basename after the buffer is saved to a path", async () => {
            const { service, component } = createEditorGroup();

            service.newUntitled();
            await service.getActiveEditor()!.saveAs(path.join(tmpDir, "note.txt"));

            expect(tabLabels(component)).toEqual(["note.txt"]);
        });
    });

    describe("content host", () => {
        it("shows the view of the active editor after a tab switch", () => {
            const { service, component } = createEditorGroup();
            service.openFile(writeFile("a.ts", "a"));
            service.openFile(writeFile("b.ts", "b"));

            service.activateTab(0);

            expect(component.view.getContent()).toBe(service.getActiveEditor()!.view);
        });

        it("clears the content when the last tab closes", () => {
            const { service, component } = createEditorGroup();
            service.openFile(writeFile("a.ts", "a"));
            expect(component.view.getContent()).not.toBeNull();

            service.closeTab(0);

            expect(component.view.getContent()).toBeNull();
        });
    });

    describe("syncTabs", () => {
        it("updates tab strip with current file names", () => {
            const { service, component } = createEditorGroup();
            service.openFile(writeFile("a.ts", "a"));
            service.openFile(writeFile("b.ts", "b"));

            const items = component.view.tabStrip.getItemElements();
            expect(items).toHaveLength(2);
            expect(items[0].getLabel()).toBe("a.ts");
            expect(items[1].getLabel()).toBe("b.ts");
        });

        it("sets active index on tab strip", () => {
            const { service, component } = createEditorGroup();
            service.openFile(writeFile("a.ts", "a"));
            service.openFile(writeFile("b.ts", "b"));

            expect(component.view.tabStrip.activeIndex).toBe(1);

            service.activateTab(0);
            expect(component.view.tabStrip.activeIndex).toBe(0);
        });
    });

    describe("modified state", () => {
        it("tab becomes modified after document edit", () => {
            const { service, component } = createEditorGroup();
            const fp = writeFile("a.ts", "const x = 1;");

            service.openFile(fp);
            const editor = service.getActiveEditor()!;
            editor.viewState.insertText("y");

            const items = component.view.tabStrip.getItemElements();
            expect(items[0].getModified()).toBe(true);
        });

        it("tab becomes not-modified after save", async () => {
            const { service, component } = createEditorGroup();
            const fp = writeFile("a.ts", "const x = 1;");

            service.openFile(fp);
            const editor = service.getActiveEditor()!;
            editor.viewState.insertText("y");
            await editor.save();

            const items = component.view.tabStrip.getItemElements();
            expect(items[0].getModified()).toBe(false);
        });

        it("tab becomes modified immediately after an EOL conversion", () => {
            const { service, component } = createEditorGroup();
            service.openFile(writeFile("a.ts", "a\nb"));

            service.getActiveEditor()!.setEol(EndOfLine.CRLF);

            const items = component.view.tabStrip.getItemElements();
            expect(items[0].getModified()).toBe(true);
        });

        it("tab clears the modified marker after undoing an EOL conversion", () => {
            const { service, component } = createEditorGroup();
            service.openFile(writeFile("a.ts", "a\nb"));
            const editor = service.getActiveEditor()!;

            editor.setEol(EndOfLine.CRLF);
            editor.undo();

            const items = component.view.tabStrip.getItemElements();
            expect(items[0].getModified()).toBe(false);
        });
    });

    describe("tab callbacks", () => {
        it("onTabActivate switches to the clicked tab", () => {
            const { service, component } = createEditorGroup();
            service.openFile(writeFile("a.ts", "a"));
            service.openFile(writeFile("b.ts", "b"));

            component.view.tabStrip.onTabActivate?.(0);

            expect(service.activeIndex).toBe(0);
        });

        it("onTabClose closes the clicked tab", () => {
            const { service, component } = createEditorGroup();
            service.openFile(writeFile("a.ts", "a"));
            service.openFile(writeFile("b.ts", "b"));

            component.view.tabStrip.onTabClose?.(0);

            expect(service.editorCount).toBe(1);
            expect(service.getActiveEditor()?.fileName).toBe("b.ts");
        });

        it("onTabClose on a modified editor defers to onRequestConfirmClose instead of closing", () => {
            const { service, component } = createEditorGroup();
            service.openFile(writeFile("a.ts", "const x = 1;"));
            const editor = service.getActiveEditor()!;
            editor.viewState.insertText("y"); // mark modified

            let confirmedIndex = -1;
            service.onRequestConfirmClose = (index) => {
                confirmedIndex = index;
            };

            component.view.tabStrip.onTabClose?.(0);

            expect(confirmedIndex).toBe(0);
            expect(service.editorCount).toBe(1); // not closed — waiting on confirmation
        });
    });

    describe("updateStyles with missing colors", () => {
        it("uses the default color registry when the theme omits editor foreground/background", () => {
            // A theme with no colors at all: the dark default registry supplies
            // editor.foreground / editor.background, so updateStyles never throws and
            // the editor group is always colored.
            const emptyTheme = WorkbenchTheme.fromThemeFile({ name: "empty", type: "dark", colors: {} });
            const themeService = new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme));
            const { service, component } = createEditorGroup({ themeService });
            service.openFile(writeFile("a.ts", "a"));

            expect(() => {
                themeService.setTheme(emptyTheme);
            }).not.toThrow();
            expect(component.view.style.fg).toBe(0xd4d4d4); // default dark "editor.foreground"
            expect(component.view.style.bg).toBe(0x1e1e1e); // default dark "editor.background"
        });
    });
});
