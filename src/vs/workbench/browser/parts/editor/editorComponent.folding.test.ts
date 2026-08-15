import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane, type TextEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";

/** The folding recompute runs on a microtask; a macrotask tick flushes it. */
function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function regionAt(ctrl: TextEditorPane, startLine: number) {
    return ctrl.viewState.foldedRegions.find((r) => r.startLine === startLine);
}

describe("EditorComponent – folding recompute keeps the caret visible", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-fold-" });
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

    it("keeps the just-indented line visible when the recompute pulls it into a collapsed region", async () => {
        // 0: block   ← region 0..1
        // 1:   a
        // 2: tail
        const ctrl = open("block\n  a\ntail");
        expect(regionAt(ctrl, 0)).toBeDefined();

        ctrl.viewState.foldRegionContaining(0); // collapse 0..1 → line 1 hidden
        ctrl.viewState.selections = [createCursorSelection(2, 0)]; // on the still-visible "tail"
        ctrl.viewState.type("  "); // indent "tail" → now nests under the block
        await flush();

        // Recompute extends the region to 0..2 and, since startLine 0 was collapsed,
        // re-collapses it — which would hide the caret. The fix reveals it again.
        const cursor = ctrl.viewState.selections[0].active.line;
        expect(cursor).toBe(2);
        expect(ctrl.viewState.logicalToVisualLine(2)).toBeGreaterThanOrEqual(0);
        expect(regionAt(ctrl, 0)?.isCollapsed).toBe(false); // expanded to keep caret shown
    });

    it("preserves the collapsed state across an unrelated far edit", async () => {
        // 0: block   ← region 0..2
        // 1:   a
        // 2:   b
        // 3: tail
        const ctrl = open("block\n  a\n  b\ntail");
        ctrl.viewState.foldRegionContaining(0);
        expect(regionAt(ctrl, 0)?.isCollapsed).toBe(true);

        ctrl.viewState.selections = [createCursorSelection(3, 4)];
        ctrl.viewState.type("!"); // edit after the region
        await flush();

        expect(regionAt(ctrl, 0)?.isCollapsed).toBe(true); // still folded
    });

    it("drops the fold when the collapsed region's header is edited (current behavior)", async () => {
        const ctrl = open("block\n  a\n  b");
        ctrl.viewState.foldRegionContaining(0);
        expect(regionAt(ctrl, 0)?.isCollapsed).toBe(true);

        ctrl.viewState.selections = [createCursorSelection(0, 0)];
        ctrl.viewState.type("x"); // edit ON the header line
        await flush();

        // The region is rebuilt from indentation but its collapsed state is lost —
        // editing a header line unfolds it (documented divergence from VS Code).
        expect(regionAt(ctrl, 0)).toBeDefined();
        expect(regionAt(ctrl, 0)?.isCollapsed).toBe(false);
    });

    it("coalesces a burst of edits into a single recompute", async () => {
        const ctrl = open("block\n  a\n  b\ntail");
        ctrl.viewState.selections = [createCursorSelection(3, 4)];
        ctrl.viewState.type("x"); // schedules recompute
        ctrl.viewState.type("y"); // second edit hits the already-scheduled guard
        await flush();

        // A single recompute ran and rebuilt regions from the final content.
        expect(regionAt(ctrl, 0)).toBeDefined();
        expect(ctrl.viewState.document.getLineContent(3)).toBe("tailxy");
    });
});
