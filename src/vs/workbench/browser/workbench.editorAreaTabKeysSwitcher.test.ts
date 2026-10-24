import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { ModifierReleaseArmoryDIToken } from "../../platform/keybinding/common/modifierReleaseArmory.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

import { TabSwitcherComponentDIToken } from "./parts/editor/tabSwitcherComponent.ts";

/** Tab switcher and the Alt variants (#818) from the Keyboard Shortcuts search box, as from text. */
describe("Workbench: tab switcher from the Keyboard Shortcuts tab", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(async () => {
        ws = createTempWorkspace({
            prefix: "diode-tab-keys-switcher-",
            files: { "a.txt": "alpha\n", "b.txt": "beta\n" },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(120, 30) });
        await h.workbench.activate();
        h.workbench.openFile(ws.path("a.txt"));
        h.workbench.openFile(ws.path("b.txt"));
        h.commands.execute("workbench.action.openGlobalKeybindings");
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const editors = () => h.container.get(EditorServiceDIToken);
    const activeLabel = (): string | undefined => editors().getActivePane()?.label;
    const switcher = () => h.container.get(TabSwitcherComponentDIToken);

    it("Ctrl+Tab Ctrl+Tab then releasing Ctrl commits the deeper MRU tab and hides the list", () => {
        h.testApp.sendKey("Ctrl+Tab");
        h.testApp.sendKey("Ctrl+Tab");
        expect(switcher().isOpen()).toBe(true);
        expect(activeLabel()).toBe("a.txt");

        h.container.get(ModifierReleaseArmoryDIToken).fireRelease("Control");
        h.testApp.render();
        expect(switcher().isOpen()).toBe(false);
        expect(editors().editorGroups.activeGroup.getMruOrder()[0]?.label).toBe("a.txt");
        expect(h.testApp.backend.screenToString()).toContain("alpha");
    });

    it("Ctrl+Shift+Tab walks the MRU backwards from Keyboard Shortcuts", () => {
        h.testApp.sendKey("Ctrl+Shift+Tab");
        expect(switcher().isOpen()).toBe(true);
        expect(activeLabel()).toBe("a.txt");
    });

    it("Alt+PgUp / Alt+PgDn cycle tabs in visual order from Keyboard Shortcuts", () => {
        h.testApp.sendKey("Alt+PageUp");
        expect(activeLabel()).toBe("b.txt");
        h.testApp.sendKey("Alt+PageDown");
        expect(activeLabel()).toBe("Keyboard Shortcuts");
    });
});
