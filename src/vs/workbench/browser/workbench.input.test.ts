import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InputElement } from "@tuidom/all/ui/inputbox/inputElement";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { typeText } from "../../../TestUtils/domQueries.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../TestUtils/timing.ts";

/**
 * End-to-end coverage for the text-input editing commands (selection, clipboard, undo/redo)
 * flowing through the real keybinding system into the QuickOpen input. This is the gap the
 * docs/TODO item describes: the actions exist but were only registered in stories, so until
 * now real inputs had no Shift-selection / Ctrl+C-X-V.
 */
describe("Workbench — input widget editing via keybindings (QuickOpen)", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "vexx-input-", files: { "alpha.txt": "Alpha" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        await h.workbench.activate();
        await h.workbench.fileIndexReady;
        // Open Quick Open — its query field is a focused InputElement.
        h.workbench.focusEditor();
        h.testApp.sendKey("Ctrl+P");
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function input(): InputElement {
        // The find widget also mounts an InputElement, so select the focused one (QuickOpen's).
        const el = h.testApp.focusedElement;
        expect(el).toBeInstanceOf(InputElement);
        return el as InputElement;
    }

    /** Clipboard actions are async (they await IClipboard); let their microtasks settle. */
    const flush = (): Promise<void> => flushMicrotasks(5);

    it("focuses the InputElement so inputWidgetFocus is active", () => {
        expect(h.testApp.focusedElement).toBeInstanceOf(InputElement);
    });

    it("types text into the input", () => {
        typeText(h.testApp, "abc");
        expect(input().inputState.value).toBe("abc");
    });

    it("Shift+ArrowLeft selects toward the start", () => {
        typeText(h.testApp, "hi");
        h.testApp.sendKey("Shift+ArrowLeft");
        expect(input().inputState.hasSelection).toBe(true);
        expect(input().inputState.selectedText).toBe("i");
    });

    it("Ctrl+A selects the whole value", () => {
        typeText(h.testApp, "hello");
        h.testApp.sendKey("Ctrl+A");
        expect(input().inputState.selectedText).toBe("hello");
    });

    it("Ctrl+C then Ctrl+V copies and pastes through the clipboard", async () => {
        typeText(h.testApp, "abc");
        h.testApp.sendKey("Ctrl+A"); // select all
        h.testApp.sendKey("Ctrl+C"); // copy "abc"
        await flush();
        h.testApp.sendKey("ArrowRight"); // collapse selection to end
        h.testApp.sendKey("Ctrl+V"); // paste "abc" at the end
        await flush();
        expect(input().inputState.value).toBe("abcabc");
    });

    it("Ctrl+X cuts the selection to the clipboard", async () => {
        typeText(h.testApp, "abc");
        h.testApp.sendKey("Ctrl+A");
        h.testApp.sendKey("Ctrl+X");
        await flush();
        expect(input().inputState.value).toBe("");
    });

    it("Ctrl+Z undoes and Ctrl+Y redoes a paste", async () => {
        typeText(h.testApp, "abc");
        h.testApp.sendKey("Ctrl+A");
        h.testApp.sendKey("Ctrl+C");
        await flush();
        h.testApp.sendKey("ArrowRight");
        h.testApp.sendKey("Ctrl+V"); // "abcabc"
        await flush();
        expect(input().inputState.value).toBe("abcabc");

        h.testApp.sendKey("Ctrl+Z"); // undo paste
        expect(input().inputState.value).toBe("abc");

        h.testApp.sendKey("Ctrl+Y"); // redo paste
        expect(input().inputState.value).toBe("abcabc");
    });
});
