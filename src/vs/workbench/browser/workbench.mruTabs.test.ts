import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import {
    ModifierReleaseArmory,
    ModifierReleaseArmoryDIToken,
} from "../../platform/keybinding/common/modifierReleaseArmory.ts";
import { EditorService, EditorServiceDIToken } from "../services/editor/browser/editorService.ts";

/**
 * Проверяет маршрутизацию keyup в Workbench: любое отпускание клавиши идёт в
 * ModifierReleaseArmory.fireRelease. Сама механика MRU покрыта в
 * EditorService.test.ts, взведение — в TabActions.test.ts и
 * ModifierReleaseArmory.test.ts; здесь — только связка keyup → armory.
 */
describe("Workbench — modifier-release routing (Ctrl release commits MRU cycle)", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let group: EditorService;
    let armory: ModifierReleaseArmory;

    beforeEach(async () => {
        ws = createTempWorkspace({
            prefix: "vexx-mru-",
            files: {
                "a.ts": "a",
                "b.ts": "b",
            },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir });
        await h.workbench.activate();

        group = h.container.get(EditorServiceDIToken);
        armory = h.container.get(ModifierReleaseArmoryDIToken);
        group.openFile(ws.path("a.ts"));
        group.openFile(ws.path("b.ts")); // MRU: b, a — active b
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function keyup(key: string): void {
        h.workbench.view.dispatchEvent(new TUIKeyboardEvent("keyup", { key }));
    }

    it("routes a modifier keyup into the armory, committing the in-progress MRU cycle", () => {
        // Mimic what the Ctrl+Tab action does: step + arm on Control release.
        group.cycleMru(1); // → a (frozen, not yet committed)
        armory.arm("Control", () => {
            group.endMruCycle();
        });
        expect(group.getActiveEditor()?.fileName).toBe("a.ts");

        keyup("Control"); // release Ctrl → armory fires → commit

        expect(group.getMruOrder().map((e) => group.displayName(e))).toEqual(["a.ts", "b.ts"]);
    });

    it("routes non-modifier keyups too, but they match no armed modifier", () => {
        const commit = vi.fn();
        armory.arm("Control", commit);

        keyup("a"); // released a normal key — no armed modifier matches
        keyup("Shift"); // wrong modifier
        expect(commit).not.toHaveBeenCalled();

        keyup("Control"); // the armed modifier
        expect(commit).toHaveBeenCalledTimes(1);
    });

    // Kitty keyup for the left Control key (codepoint 57442, event type 3 = release).
    const CONTROL_RELEASE = "\x1b[57442;1:3u";

    it("end-to-end: Ctrl+Tab cycles via the real key pipeline and Ctrl release commits", () => {
        h.workbench.focusEditor(); // focus the EditorElement → textInputFocus is active
        h.testApp.render();

        // Ctrl held, Tab pressed → MRU step from b to a.
        h.testApp.sendKey("Ctrl+Tab");
        expect(group.getActiveEditor()?.fileName).toBe("a.ts");

        // Release Ctrl → armory commits the selection to the MRU front.
        h.testApp.backend.sendRaw(CONTROL_RELEASE);
        h.testApp.backend.flushInput();
        expect(group.getMruOrder().map((e) => group.displayName(e))).toEqual(["a.ts", "b.ts"]);

        // A second press-release toggles back to b (two-newest toggle, not deeper).
        h.testApp.sendKey("Ctrl+Tab");
        expect(group.getActiveEditor()?.fileName).toBe("b.ts");
        h.testApp.backend.sendRaw(CONTROL_RELEASE);
        h.testApp.backend.flushInput();
        expect(group.getActiveEditor()?.fileName).toBe("b.ts");
    });
});
