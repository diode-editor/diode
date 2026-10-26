import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { SashElement } from "@tuidom/elements/sash/sashElement";
import { afterEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";

function mouse(action: MouseToken["action"], button: MouseToken["button"], cell: Point): MouseToken {
    return {
        kind: "mouse",
        button,
        action,
        x: cell.x + 1,
        y: cell.y + 1,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

function findSashes(element: TUIElement): SashElement[] {
    const own = element instanceof SashElement ? [element] : [];
    return [...own, ...element.getChildren().flatMap(findSashes)];
}

describe("Workbench — mouse pointer over the sashes during other drags", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function boot(): void {
        ws = createTempWorkspace({
            prefix: "diode-sash-pointer-",
            files: { "a.txt": "alpha beta gamma\nsecond line\n" },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, openFile: ws.path("a.txt"), size: new Size(80, 20) });
        h.testApp.render();
    }

    function send(action: MouseToken["action"], button: MouseToken["button"], cell: Point): void {
        h.testApp.backend.simulateMouse(mouse(action, button, cell));
        h.testApp.render();
    }

    function sidebarSash(): SashElement {
        const sash = findSashes(h.testApp.root).find((s) => !s.hidden);
        if (sash === undefined) throw new Error("no visible sash");
        return sash;
    }

    /** The screen cell where `text` starts. */
    function cellOf(text: string): Point {
        for (let y = 0; y < 20; y++) {
            for (let x = 0; x + text.length <= 80; x++) {
                if (h.testApp.backend.getTextAt(new Point(x, y), text.length) === text) return new Point(x, y);
            }
        }
        throw new Error(`no "${text}" on screen`);
    }

    // vscode selects text with pointer capture on the editor (GlobalPointerMoveMonitor →
    // setPointerCapture), so the sash's `cursor: ew-resize` never shows while a selection drag
    // passes over it; the sash does not resize on release either.
    it("a text selection dragged from the editor over the sidebar sash does not show the resize arrow", () => {
        boot();
        const start = cellOf("gamma");
        const sash = sidebarSash();
        const sashCell = new Point(sash.globalPosition.x, start.y + 1);

        send("move", "none", start);
        send("press", "left", start);
        send("move", "left", sashCell);

        expect(h.testApp.backend.pointerShape).toBe("default");

        send("release", "left", sashCell);
        expect(sidebarSash().globalPosition.x).toBe(sash.globalPosition.x);
    });
});
