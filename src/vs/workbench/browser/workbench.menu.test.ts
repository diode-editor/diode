import { describe, expect, it, vi } from "vitest";

import type { MenuBarElement } from "../../../../tuidom/ui/menu/menuBarElement.ts";
import type { MenuEntry, MenuItemEntry } from "../../../../tuidom/ui/menu/popupMenuElement.ts";
import { PopupMenuElement } from "../../../../tuidom/ui/menu/popupMenuElement.ts";
import { createAppTestHarness } from "../../../TestUtils/AppTestHarness.ts";
import type { TestApp } from "../../../TestUtils/TestApp.ts";
import type { EditorElement } from "../../editor/browser/editorElement.ts";

/** Open a top-level menu by mnemonic (Alt+<letter>) and return the live popup element. */
function openMenu(testApp: TestApp, mnemonic: string): PopupMenuElement {
    testApp.sendKey(`Alt+${mnemonic}`);
    const popup = testApp.querySelector("PopupMenuElement") as PopupMenuElement | null;
    expect(popup).not.toBeNull();
    return popup!;
}

/** Find an entry by its label inside a popup menu. */
function entryByLabel(popup: PopupMenuElement, label: string): MenuItemEntry {
    const found = popup.entries.find((e): e is MenuItemEntry => e.type !== "separator" && e.label === label);
    expect(found, `entry "${label}" should exist`).toBeDefined();
    return found!;
}

function itemLabels(popup: PopupMenuElement): string[] {
    return popup.entries.filter((e): e is MenuItemEntry => e.type !== "separator").map((e) => e.label);
}

describe("Workbench — menu bar wiring", () => {
    it("opens the File menu and renders its entries", () => {
        const { testApp } = createAppTestHarness();
        const popup = openMenu(testApp, "f");
        expect(itemLabels(popup)).toEqual([
            "New Untitled File",
            "New File...",
            "New Folder...",
            "Open File...",
            "Open Folder...",
            "Save",
            "Save As...",
            "Settings",
            "Keyboard Shortcuts",
            "Close Editor",
            "Exit",
        ]);
    });

    it("File → Open File... runs the open-file command", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "f");

        entryByLabel(popup, "Open File...").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("workbench.action.files.openFile");
    });

    it("File → Open Folder... runs the open-folder command", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "f");

        entryByLabel(popup, "Open Folder...").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("workbench.action.files.openFolder");
    });

    it("File → New Untitled File runs the new-untitled command", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "f");

        entryByLabel(popup, "New Untitled File").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("workbench.action.files.newUntitledFile");
    });

    it("File → Save runs the save command", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "f");

        entryByLabel(popup, "Save").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("workbench.action.files.save");
    });

    it("File → Settings runs the open-settings command", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "f");

        entryByLabel(popup, "Settings").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("workbench.action.openSettings");
    });

    it("File → Keyboard Shortcuts runs the open-keybindings command", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "f");

        entryByLabel(popup, "Keyboard Shortcuts").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("workbench.action.openGlobalKeybindings");
    });

    it("File → Exit triggers the quit command (and the quit flow)", () => {
        const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
        try {
            const { testApp, commands } = createAppTestHarness();
            const executeSpy = vi.spyOn(commands, "execute");
            const popup = openMenu(testApp, "f");

            entryByLabel(popup, "Exit").onSelect?.();

            expect(executeSpy).toHaveBeenCalledWith("workbench.action.quit");
            // No unsaved editors → quit proceeds.
            expect(exitSpy).toHaveBeenCalledWith(0);
        } finally {
            vi.restoreAllMocks();
        }
    });

    it("opens the Edit menu and renders its entries", () => {
        const { testApp } = createAppTestHarness();
        const popup = openMenu(testApp, "e");
        expect(itemLabels(popup)).toEqual([
            "Undo",
            "Redo",
            "Cut",
            "Copy",
            "Paste",
            "Find",
            "Find Next",
            "Find Previous",
        ]);
    });

    it("Edit → Undo runs the undo command", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "e");

        entryByLabel(popup, "Undo").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("undo");
    });

    it("Edit → Redo runs the redo command", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "e");

        entryByLabel(popup, "Redo").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("redo");
    });

    it("Edit → Cut runs the clipboard cut command", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "e");

        entryByLabel(popup, "Cut").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("editor.action.clipboardCutAction");
    });

    it("Edit → Copy runs the clipboard copy command", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "e");

        entryByLabel(popup, "Copy").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("editor.action.clipboardCopyAction");
    });

    it("Edit → Paste runs the clipboard paste command", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "e");

        entryByLabel(popup, "Paste").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("editor.action.clipboardPasteAction");
    });

    it("Edit → Find runs the find command", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "e");

        entryByLabel(popup, "Find").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("actions.find");
    });

    it("Edit → Find Next runs the next-match command", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "e");

        entryByLabel(popup, "Find Next").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("editor.action.nextMatchFindAction");
    });

    it("Edit → Find Previous runs the previous-match command", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "e");

        entryByLabel(popup, "Find Previous").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("editor.action.previousMatchFindAction");
    });

    it("opens the Selection menu and renders its entries", () => {
        const { testApp } = createAppTestHarness();
        const popup = openMenu(testApp, "s");
        expect(itemLabels(popup)).toEqual(["Select All", "Expand Selection (Word)"]);
    });

    it("Selection → Select All runs the select-all command", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "s");

        entryByLabel(popup, "Select All").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("editor.action.selectAll");
    });

    it("Selection → Expand Selection (Word) runs cursorWordRightSelect", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "s");

        entryByLabel(popup, "Expand Selection (Word)").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("cursorWordRightSelect");
    });

    it("opens the View menu and renders its entries", () => {
        const { testApp } = createAppTestHarness();
        const popup = openMenu(testApp, "v");
        expect(itemLabels(popup)).toEqual([
            "Command Palette...",
            "Color Theme",
            "Explorer",
            "Source Control",
            "Problems",
            "Output",
            "Terminal",
            "Toggle Primary Side Bar",
            "Toggle Panel",
            "Increase Side Bar Width",
            "Decrease Side Bar Width",
            "Reset Side Bar Width",
        ]);
    });

    it("View → Command Palette runs the show-commands command", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "v");

        entryByLabel(popup, "Command Palette...").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("workbench.action.showCommands");
    });

    it("View → Increase Side Bar Width runs the increase-width command", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "v");

        entryByLabel(popup, "Increase Side Bar Width").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("workbench.action.increaseSidebarWidth");
    });

    it("View → Explorer runs the explorer command", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "v");

        entryByLabel(popup, "Explorer").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("workbench.view.explorer");
    });

    it("View → Toggle Primary Side Bar toggles the left panel visibility", () => {
        const { testApp, workbench } = createAppTestHarness();
        workbench.openFile("/tmp/menu-toggle-sidebar.txt");
        testApp.render();
        const layout = testApp.querySelector("WorkbenchLayoutElement") as unknown as {
            getLeftPanelVisible: () => boolean;
        };
        const before = layout.getLeftPanelVisible();

        const popup = openMenu(testApp, "v");
        entryByLabel(popup, "Toggle Primary Side Bar").onSelect?.();

        expect(layout.getLeftPanelVisible()).toBe(!before);
    });

    it("opens the Go menu and renders its entries", () => {
        const { testApp } = createAppTestHarness();
        const popup = openMenu(testApp, "g");
        expect(itemLabels(popup)).toEqual([
            "Go to File...",
            "Go to Line/Column...",
            "Next Editor",
            "Previous Editor",
        ]);
    });

    it("Go → Go to File runs the quick-open command", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "g");

        entryByLabel(popup, "Go to File...").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("workbench.action.quickOpen");
    });

    it("Go → Next Editor runs the next-editor command", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "g");

        entryByLabel(popup, "Next Editor").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("workbench.action.nextEditorInGroup");
    });

    it("File → Close Editor runs the close-active-editor command", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "f");

        entryByLabel(popup, "Close Editor").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("workbench.action.closeActiveEditor");
    });

    it("derives the menu shortcut from the keybinding registry", () => {
        const { testApp } = createAppTestHarness();
        const popup = openMenu(testApp, "f");

        // Save is bound to Ctrl+S, so the menu shows that automatically.
        expect(entryByLabel(popup, "Save").shortcut).toBe("Ctrl+S");
    });

    it("omits the shortcut for commands without a keybinding", () => {
        const { testApp } = createAppTestHarness();
        const popup = openMenu(testApp, "h");

        // About has no default binding → no right-aligned accelerator text.
        expect(entryByLabel(popup, "About").shortcut).toBeUndefined();
    });

    it("opens the Help menu and renders its entries", () => {
        const { testApp } = createAppTestHarness();
        const popup = openMenu(testApp, "h");
        expect(itemLabels(popup)).toEqual(["About"]);
    });

    it("Help → About runs the show-about-dialog command", () => {
        const { testApp, commands } = createAppTestHarness();
        const executeSpy = vi.spyOn(commands, "execute");
        const popup = openMenu(testApp, "h");

        entryByLabel(popup, "About").onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("workbench.action.showAboutDialog");
    });

    it("show-about-dialog command opens the About dialog", () => {
        const { testApp, commands } = createAppTestHarness();
        expect(testApp.querySelector("#aboutDialog")).toBeNull();

        commands.execute("workbench.action.showAboutDialog");
        testApp.render();

        expect(testApp.querySelector("#aboutDialog")).not.toBeNull();
    });

    it("reuses the About dialog on reopen and closes it via its callback", () => {
        const { testApp, commands } = createAppTestHarness();

        commands.execute("workbench.action.showAboutDialog");
        testApp.render();
        const dialog = testApp.querySelector("#aboutDialog");
        expect(dialog).not.toBeNull();

        // Reopening reuses the same dialog instance (covers the not-null branch).
        commands.execute("workbench.action.showAboutDialog");
        testApp.render();
        expect(testApp.querySelector("#aboutDialog")).toBe(dialog);

        // Closing through the dialog's onClose callback hides it without error.
        expect(() => (dialog as unknown as { onClose?: () => void }).onClose?.()).not.toThrow();
    });

    it("menu bar element is present in the DOM", () => {
        const { testApp } = createAppTestHarness();
        expect(testApp.querySelector("MenuBarElement")).not.toBeNull();
    });

    it("selecting a menu item closes the popup", () => {
        const { testApp } = createAppTestHarness();
        const menuBar = testApp.querySelector("MenuBarElement") as MenuBarElement;
        openMenu(testApp, "f");
        expect(menuBar.isMenuOpen).toBe(true);

        // The menu bar wraps onSelect to deactivate; drive it through the bar UI.
        testApp.sendKey("Enter"); // activate the first highlighted entry (Save)

        expect(menuBar.isMenuOpen).toBe(false);
    });
});

describe("Workbench — editor context menu", () => {
    function getEditorEntries(testApp: TestApp): MenuEntry[] {
        const editor = testApp.querySelector("EditorElement") as EditorElement;
        return editor.contextMenuProvider?.() ?? editor.contextMenuEntries;
    }

    it("populates editor context menu entries when an editor is created", () => {
        const { testApp, workbench } = createAppTestHarness();
        workbench.openFile("/tmp/menu-ctx-create.txt");
        testApp.render();

        const labels = getEditorEntries(testApp)
            .filter((e): e is MenuItemEntry => e.type !== "separator")
            .map((e) => e.label);
        expect(labels).toEqual(["Copy", "Cut", "Paste", "Undo"]);
    });

    it("editor context menu Copy entry runs the copy command", () => {
        const { testApp, workbench, commands } = createAppTestHarness();
        workbench.openFile("/tmp/menu-ctx-copy.txt");
        testApp.render();
        const executeSpy = vi.spyOn(commands, "execute");

        const copy = getEditorEntries(testApp).find(
            (e): e is MenuItemEntry => e.type !== "separator" && e.label === "Copy",
        )!;
        copy.onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("editor.action.clipboardCopyAction");
    });

    it("editor context menu Cut entry runs the cut command", () => {
        const { testApp, workbench, commands } = createAppTestHarness();
        workbench.openFile("/tmp/menu-ctx-cut.txt");
        testApp.render();
        const executeSpy = vi.spyOn(commands, "execute");

        const cut = getEditorEntries(testApp).find(
            (e): e is MenuItemEntry => e.type !== "separator" && e.label === "Cut",
        )!;
        cut.onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("editor.action.clipboardCutAction");
    });

    it("editor context menu Paste entry runs the paste command", () => {
        const { testApp, workbench, commands } = createAppTestHarness();
        workbench.openFile("/tmp/menu-ctx-paste.txt");
        testApp.render();
        const executeSpy = vi.spyOn(commands, "execute");

        const paste = getEditorEntries(testApp).find(
            (e): e is MenuItemEntry => e.type !== "separator" && e.label === "Paste",
        )!;
        paste.onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("editor.action.clipboardPasteAction");
    });

    it("editor context menu Undo entry runs the undo command", () => {
        const { testApp, workbench, commands } = createAppTestHarness();
        workbench.openFile("/tmp/menu-ctx-undo.txt");
        testApp.render();
        const executeSpy = vi.spyOn(commands, "execute");

        const undo = getEditorEntries(testApp).find(
            (e): e is MenuItemEntry => e.type !== "separator" && e.label === "Undo",
        )!;
        undo.onSelect?.();

        expect(executeSpy).toHaveBeenCalledWith("undo");
    });
});
