import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";

// Контракт: «клавиша съедена (defaultPrevented) ⇒ кадр грязный» — команда может
// менять состояние мимо markDirty-сеттеров. Под damage-tracking это fallback
// (см. workbench.damageScope.test.ts).

describe("Workbench — съеденный кейбинд помечает кадр грязным", () => {
    let h: IAppHarness;

    beforeEach(() => {
        h = createAppTestHarness();
    });

    afterEach(() => {
        h.dispose();
    });

    it("keydown, съеденный командой, оставляет root layout-dirty", () => {
        h.workbench.openFile("/tmp/dirty-gate.txt");
        h.workbench.focusEditor();
        h.testApp.render();
        expect(h.testApp.root.isLayoutDirty).toBe(false);

        const editor = h.testApp.focusedElement!;
        const event = new TUIKeyboardEvent("keydown", { key: "ArrowUp", ctrlKey: true });
        editor.dispatchEvent(event);

        // scrollLineUp (ctrl+up, textInputFocus) съел клавишу — кадр грязный,
        // хотя сама команда не дёрнула ни одного markDirty-сеттера.
        expect(event.defaultPrevented).toBe(true);
        expect(h.testApp.root.isLayoutDirty).toBe(true);
    });

    it("keydown без кейбинда кадр не пачкает", () => {
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
