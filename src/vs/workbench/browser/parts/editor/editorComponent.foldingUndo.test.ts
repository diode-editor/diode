import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";

function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function regionAt(ctrl: TextEditorPane, startLine: number) {
    return ctrl.viewState.foldedRegions.find((r) => r.startLine === startLine);
}

describe("EditorComponent – undo/redo × folding", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-foldundo-" });
    });
    afterEach(() => {
        ws.dispose();
    });

    function open(content: string): TextEditorPane {
        const filePath = ws.writeFile("doc.txt", content);
        const ctrl = createEditorPane();
        ctrl.openFile(Uri.file(filePath));
        return ctrl;
    }

    it("keeps a region collapsed after an undo that shifts lines above it", async () => {
        // 0: top
        // 1: block   ← region 1..3
        // 2:   a
        // 3:   b
        // 4: end
        const ctrl = open("top\nblock\n  a\n  b\nend");
        ctrl.viewState.foldRegionContaining(1);
        expect(regionAt(ctrl, 1)?.isCollapsed).toBe(true);

        ctrl.viewState.selections = [createCursorSelection(0, 0)];
        ctrl.pushUndo(ctrl.viewState.type("X\n")); // insert a line ABOVE the region
        await flush();
        expect(regionAt(ctrl, 2)?.isCollapsed).toBe(true); // region shifted to 2..4, still folded

        ctrl.undo();
        await flush();

        // Undo shifts the region back to 1..3 (via adjustFoldingRegionsForEdits) so
        // the recompute re-keys its collapsed state correctly — it stays folded.
        expect(regionAt(ctrl, 1)?.isCollapsed).toBe(true);
    });

    it("re-collapses correctly after a redo that shifts lines above the region", async () => {
        const ctrl = open("top\nblock\n  a\n  b\nend");
        ctrl.viewState.foldRegionContaining(1);
        ctrl.viewState.selections = [createCursorSelection(0, 0)];
        ctrl.pushUndo(ctrl.viewState.type("X\n"));
        await flush();
        ctrl.undo();
        await flush();

        ctrl.redo();
        await flush();
        expect(regionAt(ctrl, 2)?.isCollapsed).toBe(true); // region back at 2..4, folded
    });

    it("drops the region cleanly when an undo deletes its lines", async () => {
        const ctrl = open("keep");
        ctrl.viewState.selections = [createCursorSelection(0, 4)];
        ctrl.pushUndo(ctrl.viewState.type("\nblock\n  a\n  b")); // build a foldable block
        await flush();
        ctrl.viewState.foldRegionContaining(1);
        expect(regionAt(ctrl, 1)?.isCollapsed).toBe(true);

        ctrl.undo(); // removes the whole block
        await flush();

        expect(ctrl.getText()).toBe("keep");
        expect(ctrl.viewState.foldedRegions.length).toBe(0);
        // Projection stays consistent — no stale hidden ranges past the document.
        expect(ctrl.viewState.getViewLineCount()).toBe(ctrl.viewState.document.lineCount);
    });

    it("reveals the caret when undo restores it into a still-collapsed region", async () => {
        // 0: block   ← region 0..2
        // 1:   a
        // 2:   b
        const ctrl = open("block\n  a\n  b");
        ctrl.viewState.selections = [createCursorSelection(1, 3)]; // end of "  a"
        ctrl.pushUndo(ctrl.viewState.type("!")); // edit inside the (future) region body
        await flush();
        ctrl.viewState.foldRegionContaining(0); // collapse 0..2 → caret snaps to header

        ctrl.undo(); // restores caret to (1,3), inside the collapsed region
        await flush();

        const cursor = ctrl.viewState.selections[0].active;
        expect(cursor.line).toBe(1);
        // restoreSelections expands the fold hiding the restored caret (VS Code parity).
        expect(ctrl.viewState.logicalToVisualLine(1)).toBeGreaterThanOrEqual(0);
        expect(regionAt(ctrl, 0)?.isCollapsed).toBe(false);
    });
});
