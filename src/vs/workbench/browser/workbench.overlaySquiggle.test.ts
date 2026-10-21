import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { EditorElement } from "../../editor/browser/editorElement.ts";
import { createRange } from "../../editor/common/core/iRange.ts";
import { MarkerSeverity } from "../../platform/markers/common/iMarker.ts";

// The diagnostics squiggle bled through overlays: opaque painters did not
// reset the partial-patch style flags. Fixed in the engine (tuidom#4,
// @tuidom/core 0.2.1); the test guards the frame, not how the fix works.
describe("Workbench: overlay above squiggled text", () => {
    const SIZE = new Size(100, 30);
    let ws: ITempWorkspace;
    let h: IAppHarness;

    function pickerRect(): { x: number; y: number; width: number; height: number } {
        const picker = h.testApp.querySelector("QuickPickFrameElement");
        expect(picker).not.toBeNull();
        const position = picker!.globalPosition;
        const size = picker!.layoutSize;
        return { x: position.x, y: position.y, width: size.width, height: size.height };
    }

    function undercurledCells(rect: { x: number; y: number; width: number; height: number }): number {
        const screen = h.testApp.app.screen;
        let count = 0;
        for (let y = rect.y; y < rect.y + rect.height; y++) {
            for (let x = rect.x; x < rect.x + rect.width; x++) {
                if ((screen.getCell(new Point(x, y)).style & StyleFlags.Undercurl) !== 0) count++;
            }
        }
        return count;
    }

    beforeEach(async () => {
        ws = createTempWorkspace({
            prefix: "diode-overlay-squiggle-",
            files: {
                // Every line is long and fully underlined: the picker opens at the
                // top edge and lands right on the squiggle.
                "alpha.ts": Array.from({ length: 20 }, (_, i) => `const value${i} = ${i}; // lorem ipsum dolor`).join(
                    "\n",
                ),
            },
        });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: ws.path("alpha.ts"),
            focusEditor: true,
            size: SIZE,
        });
        await h.workbench.activate();
        await h.workbench.fileIndexReady;

        const editor = h.testApp.querySelector("EditorElement") as EditorElement;
        editor.markerDecorations = Array.from({ length: 20 }, (_, line) => ({
            range: createRange(line, 0, line, 40),
            severity: MarkerSeverity.Error,
        }));
        editor.markDirty();
        h.testApp.render();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("the squiggle is visible in the editor while the picker is closed", () => {
        const editor = h.testApp.querySelector("EditorElement") as EditorElement;
        const rect = {
            x: editor.globalPosition.x,
            y: editor.globalPosition.y,
            width: editor.layoutSize.width,
            height: editor.layoutSize.height,
        };
        expect(undercurledCells(rect)).toBeGreaterThan(0);
    });

    it("quick pick does not let the editor squiggle show through", () => {
        h.testApp.sendKey("Ctrl+P");
        h.testApp.render();

        expect(undercurledCells(pickerRect())).toBe(0);
    });

    it("the squiggle comes back when the picker is closed", () => {
        h.testApp.sendKey("Ctrl+P");
        h.testApp.render();
        const rect = pickerRect();

        h.testApp.sendKey("Escape");
        h.testApp.render();

        expect(undercurledCells(rect)).toBeGreaterThan(0);
    });
});
