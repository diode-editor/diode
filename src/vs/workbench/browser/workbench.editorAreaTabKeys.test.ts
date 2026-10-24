import { Size } from "@tuidom/core/common/geometryPromitives";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

import { TabSwitcherComponentDIToken } from "./parts/editor/tabSwitcherComponent.ts";

/** Tab keys (#818) work from any tab of the editor area, not only from text. */
describe("Workbench: tab keys from a non-text tab (Keyboard Shortcuts)", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "diode-tab-keys-", files: { "a.txt": "alpha\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(120, 30) });
        await h.workbench.activate();
        h.workbench.openFile(ws.path("a.txt"));
        h.commands.execute("workbench.action.openGlobalKeybindings");
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const contextKeys = () => h.container.get(ContextKeyServiceDIToken);
    const tabLabels = (): string[] =>
        h.container
            .get(EditorServiceDIToken)
            .editorGroups.activeGroup.getPanes()
            .map((pane) => pane.label);
    const activeLabel = (): string | undefined => h.container.get(EditorServiceDIToken).getActivePane()?.label;
    const screen = (): string => {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    };

    function focusList(): void {
        const list = h.container.get(EditorServiceDIToken).getActivePane()!.view.querySelector("#keybindingsList")!;
        list.focus();
        h.testApp.render();
        expect(h.testApp.focusedElement).toBeInstanceOf(ListViewElement);
    }

    it("the search box has focus and editorAreaFocus is set", () => {
        expect(h.testApp.focusedElement).toBeInstanceOf(InputElement);
        expect(contextKeys().get("editorAreaFocus")).toBe(true);
        expect(contextKeys().get("textViewFocus")).toBe(false);
    });

    it("Ctrl+PgUp from the search box activates the file tab, Ctrl+PgDn comes back", () => {
        h.testApp.sendKey("Ctrl+PageUp");
        expect(activeLabel()).toBe("a.txt");
        expect(screen()).toContain("alpha");

        h.testApp.sendKey("Ctrl+PageDown");
        expect(activeLabel()).toBe("Keyboard Shortcuts");
    });

    it("Ctrl+W from the search box closes the Keyboard Shortcuts tab", () => {
        h.testApp.sendKey("Ctrl+W");
        expect(tabLabels()).toEqual(["a.txt"]);
        expect(screen()).toContain("alpha");
    });

    it("Ctrl+Tab from the search box opens the tab switcher and steps to the file", () => {
        h.testApp.sendKey("Ctrl+Tab");
        expect(h.container.get(TabSwitcherComponentDIToken).isOpen()).toBe(true);
        expect(activeLabel()).toBe("a.txt");
    });

    it("Ctrl+6 from the search box toggles to the previous tab", () => {
        h.testApp.sendKey("Ctrl+6");
        expect(activeLabel()).toBe("a.txt");
    });

    it("from the rows list Ctrl+PgUp switches and Ctrl+W closes", () => {
        focusList();
        expect(contextKeys().get("editorAreaFocus")).toBe(true);
        h.testApp.sendKey("Ctrl+PageUp");
        expect(activeLabel()).toBe("a.txt");

        h.testApp.sendKey("Ctrl+PageDown");
        focusList();
        h.testApp.sendKey("Ctrl+W");
        expect(tabLabels()).toEqual(["a.txt"]);
    });

    it("with Define Keybinding open, Ctrl+W and Ctrl+PgUp are recorded, the tab stays", () => {
        focusList();
        h.testApp.sendKey("ArrowDown");
        h.testApp.sendKey("Enter");
        expect(screen()).toContain("Press desired key combination");
        expect(contextKeys().get("editorAreaFocus")).toBe(false);

        h.testApp.sendKey("Ctrl+W");
        expect(screen()).toContain("Ctrl+W");
        h.testApp.sendKey("Ctrl+PageUp");
        expect(tabLabels()).toEqual(["a.txt", "Keyboard Shortcuts"]);
        expect(activeLabel()).toBe("Keyboard Shortcuts");
    });

    it("from the Explorer tab keys do nothing", () => {
        h.testApp.querySelector("TreeViewElement")!.focus();
        h.testApp.render();
        expect(contextKeys().get("editorAreaFocus")).toBe(false);

        h.testApp.sendKey("Ctrl+PageUp");
        h.testApp.sendKey("Ctrl+W");
        expect(tabLabels()).toEqual(["a.txt", "Keyboard Shortcuts"]);
        expect(activeLabel()).toBe("Keyboard Shortcuts");
    });

    it("the command palette and the panel terminal are outside the editor area", () => {
        h.commands.execute("workbench.action.showCommands");
        h.testApp.render();
        expect(contextKeys().get("editorAreaFocus")).toBe(false);
        h.testApp.sendKey("Escape");

        h.commands.execute("workbench.action.terminal.new");
        h.testApp.render();
        expect(contextKeys().get("terminalFocus")).toBe(true);
        expect(contextKeys().get("editorAreaFocus")).toBe(false);
    });
});
