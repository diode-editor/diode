import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";

// Contract: "key consumed (defaultPrevented) ⇒ frame dirty" — a command may change
// state bypassing the markDirty setters. Under damage tracking this is a fallback
// (see workbench.damageScope.test.ts).

describe("Workbench — a consumed keybinding marks the frame dirty", () => {
    let h: IAppHarness;

    beforeEach(() => {
        h = createAppTestHarness();
    });

    afterEach(() => {
        h.dispose();
    });

    it("a keydown consumed by a command leaves the root layout-dirty", () => {
        h.workbench.openFile("/tmp/dirty-gate.txt");
        h.workbench.focusEditor();
        h.testApp.render();
        expect(h.testApp.root.isLayoutDirty).toBe(false);

        const editor = h.testApp.focusedElement!;
        const event = new TUIKeyboardEvent("keydown", { key: "ArrowUp", ctrlKey: true });
        editor.dispatchEvent(event);

        // scrollLineUp (ctrl+up, textInputFocus) consumed the key — the frame is dirty
        // even though the command itself called no markDirty setter.
        expect(event.defaultPrevented).toBe(true);
        expect(h.testApp.root.isLayoutDirty).toBe(true);
    });

    it("a keydown without a keybinding does not dirty the frame", () => {
        h.workbench.openFile("/tmp/dirty-gate-2.txt");
        h.workbench.focusEditor();
        h.testApp.render();
        expect(h.testApp.root.isLayoutDirty).toBe(false);

        const editor = h.testApp.focusedElement!;
        const event = new TUIKeyboardEvent("keydown", { key: "x" });
        editor.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
        expect(h.testApp.root.isLayoutDirty).toBe(false);
    });
});
