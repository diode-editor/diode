import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { EditorElement } from "../../editor/browser/editorElement.ts";
import { createRange } from "../../editor/common/core/iRange.ts";
import { MarkerSeverity } from "../../platform/markers/common/iMarker.ts";

// Волна диагностик просвечивала сквозь оверлеи: непрозрачные художники не
// сбрасывали флаги стиля частичного патча. Лечится в движке (tuidom#4,
// @tuidom/core 0.2.1); тест сторожит кадр, а не устройство фикса.
describe("Workbench — оверлей поверх подчёркнутого текста", () => {
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
                // Каждая строка длинная и подчёркнута целиком — пикер открывается
                // у верхней кромки и ложится ровно на волну.
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

    it("волна видна в редакторе, пока пикер закрыт", () => {
        const editor = h.testApp.querySelector("EditorElement") as EditorElement;
        const rect = {
            x: editor.globalPosition.x,
            y: editor.globalPosition.y,
            width: editor.layoutSize.width,
            height: editor.layoutSize.height,
        };
        expect(undercurledCells(rect)).toBeGreaterThan(0);
    });

    it("quick pick не пропускает волну редактора сквозь себя", () => {
        h.testApp.sendKey("Ctrl+P");
        h.testApp.render();

        expect(undercurledCells(pickerRect())).toBe(0);
    });

    it("волна возвращается на место, когда пикер закрыт", () => {
        h.testApp.sendKey("Ctrl+P");
        h.testApp.render();
        const rect = pickerRect();

        h.testApp.sendKey("Escape");
        h.testApp.render();

        expect(undercurledCells(rect)).toBeGreaterThan(0);
    });
});
