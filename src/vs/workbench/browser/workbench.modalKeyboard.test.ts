import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TUIElement } from "@tuidom/all/dom/tuiElement";
import type { QuickPickElement } from "@tuidom/all/ui/quickpick/quickPickElement";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";

const TOGGLE_SIDEBAR = "workbench.action.toggleSidebarVisibility";

/** Walk up the parent chain to confirm `el` lives inside `ancestor`. */
function isDescendantOf(el: TUIElement | null, ancestor: TUIElement): boolean {
    let cur = el;
    while (cur) {
        if (cur === ancestor) return true;
        cur = cur.getParent();
    }
    return false;
}

describe("Workbench — global keybindings are suppressed while an overlay owns the keyboard", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(async () => {
        ws = createTempWorkspace({
            prefix: "vexx-modalkbd-",
            files: {
                "alpha.txt": "Alpha content",
                "beta.txt": "Beta content",
            },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        await h.workbench.activate();
        await h.workbench.fileIndexReady;
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
        vi.restoreAllMocks();
    });

    it("quickpick swallows Ctrl+B: sidebar does not toggle, focus stays, overlay stays up", () => {
        h.workbench.focusEditor();
        h.testApp.sendKey("Ctrl+P");
        h.testApp.render();

        const picker = h.testApp.querySelector("QuickPickElement") as QuickPickElement;
        expect(picker).toBeTruthy();
        expect(h.testApp.focusedElement).toBe(picker.inputElement);

        const before = h.workbench.workbenchLayout.getLeftPanelVisible();
        const executeSpy = vi.spyOn(h.commands, "execute");

        h.testApp.sendKey("Ctrl+B");
        h.testApp.render();

        expect(executeSpy).not.toHaveBeenCalledWith(TOGGLE_SIDEBAR);
        expect(h.workbench.workbenchLayout.getLeftPanelVisible()).toBe(before); // global did NOT fire
        expect(h.testApp.focusedElement).toBe(picker.inputElement); // focus stayed in the picker
        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(true); // overlay not orphaned
    });

    it("typing still reaches the quickpick input while it owns the keyboard", () => {
        h.workbench.focusEditor();
        h.testApp.sendKey("Ctrl+P");
        h.testApp.render();

        const picker = h.testApp.querySelector("QuickPickElement") as QuickPickElement;
        expect(picker).toBeTruthy();

        h.testApp.sendKey("a");
        h.testApp.sendKey("l");
        h.testApp.render();

        expect(picker.getQuery()).toBe("al");
    });

    it("focus-scoped editing works in the quickpick while workbench shortcuts stay suppressed", () => {
        h.workbench.focusEditor();
        h.testApp.sendKey("Ctrl+P");
        h.testApp.render();

        const picker = h.testApp.querySelector("QuickPickElement") as QuickPickElement;
        h.testApp.sendKey("h");
        h.testApp.sendKey("i");

        // Ctrl+A (when: inputWidgetFocus) is focus-scoped → it edits the query…
        h.testApp.sendKey("Ctrl+A");
        h.testApp.render();
        expect(picker.inputElement.inputState.selectedText).toBe("hi");

        // …but Ctrl+B (a workbench command, no focus-scoped when) is still swallowed.
        const before = h.workbench.workbenchLayout.getLeftPanelVisible();
        h.testApp.sendKey("Ctrl+B");
        h.testApp.render();
        expect(h.workbench.workbenchLayout.getLeftPanelVisible()).toBe(before);
        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(true);
    });

    it("a chord prefix does not start a chord while the quickpick owns the keyboard", () => {
        h.workbench.focusEditor();
        h.testApp.sendKey("Ctrl+P");
        h.testApp.render();

        const picker = h.testApp.querySelector("QuickPickElement") as QuickPickElement;
        expect(picker).toBeTruthy();

        // Ctrl+K is the prefix of the GLOBAL "Ctrl+K S → save" chord (no when), so it would
        // start a chord anywhere. While the quickpick owns the keyboard it must not: the pending
        // chord is reset, so the next key still types into the query instead of being swallowed
        // as a (broken) chord continuation.
        h.testApp.sendKey("Ctrl+K");
        h.testApp.sendKey("z");
        h.testApp.render();

        expect(picker.getQuery()).toBe("z");
        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(true);
    });

    it("the quickpick's own keys still work (ArrowDown moves selection, Escape closes)", () => {
        h.workbench.focusEditor();
        h.testApp.sendKey("Ctrl+P");
        h.testApp.render();

        const picker = h.testApp.querySelector("QuickPickElement") as QuickPickElement;
        expect(picker.items.length).toBeGreaterThan(1);
        expect(picker.selectedIndex).toBe(0);

        h.testApp.sendKey("ArrowDown");
        h.testApp.render();
        expect(picker.selectedIndex).toBe(1);

        h.testApp.sendKey("Escape");
        h.testApp.render();
        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("a modal confirm dialog swallows Ctrl+B", () => {
        h.workbench.showConfirmSaveDialog("alpha.txt", {
            onSave: () => {},
            onDontSave: () => {},
            onCancel: () => {},
        });
        h.testApp.render();

        const dialog = h.testApp.querySelector("#confirmSaveDialog");
        expect(dialog).toBeTruthy();
        expect(isDescendantOf(h.testApp.focusedElement, dialog!)).toBe(true);

        const before = h.workbench.workbenchLayout.getLeftPanelVisible();
        const executeSpy = vi.spyOn(h.commands, "execute");

        h.testApp.sendKey("Ctrl+B");
        h.testApp.render();

        expect(executeSpy).not.toHaveBeenCalledWith(TOGGLE_SIDEBAR);
        expect(h.workbench.workbenchLayout.getLeftPanelVisible()).toBe(before);
        expect(h.testApp.root.overlayLayer.hasVisibleItems()).toBe(true); // dialog still up
    });

    it("a passthrough overlay (Find) does NOT suppress globals — Ctrl+B still toggles the sidebar", () => {
        h.commands.execute("workbench.openFile", ws.path("alpha.txt"));
        h.testApp.render();

        h.commands.execute("actions.find");
        h.testApp.render();

        const findWidget = h.testApp.querySelector("#findWidget");
        expect(findWidget).toBeTruthy();
        // Find genuinely opened and owns focus, so the scenario is real.
        expect(isDescendantOf(h.testApp.focusedElement, findWidget!)).toBe(true);

        const before = h.workbench.workbenchLayout.getLeftPanelVisible();
        h.testApp.sendKey("Ctrl+B");
        h.testApp.render();

        // Find lives in the editor-group overlay layer and is passthrough, so the body
        // dispatcher's gate ignores it: the global shortcut fires as usual.
        expect(h.workbench.workbenchLayout.getLeftPanelVisible()).toBe(!before);
    });
});
