import { describe, expect, it } from "vitest";

import { createCursorSelection } from "../core/iSelection.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

function makeState(lines: string): EditorViewState {
    return new EditorViewState(new TextDocument(lines), [createCursorSelection(0, 0)]);
}

/** All view lines as a compact string: the doc line number, or `·` for a zone. */
function sketch(state: EditorViewState): string {
    const parts: string[] = [];
    for (let v = 0; v < state.getViewLineCount(); v++) {
        const log = state.visualToLogicalLine(v);
        parts.push(log >= 0 ? String(log) : "·");
    }
    return parts.join(" ");
}

describe("EditorViewState view zones — projection", () => {
    it("a zone adds virtual lines after the anchor without consuming document line numbers", () => {
        const state = makeState("a\nb\nc");
        state.setViewZones([{ afterLine: 0, size: 2 }]);

        expect(state.getViewLineCount()).toBe(5);
        expect(sketch(state)).toBe("0 · · 1 2");
    });

    it("anchor -1 puts the zone before the first line", () => {
        const state = makeState("a\nb");
        state.setViewZones([{ afterLine: -1, size: 1 }]);

        expect(sketch(state)).toBe("· 0 1");
    });

    it("a zone at end of file and clamping an anchor past the end", () => {
        const state = makeState("a\nb");
        state.setViewZones([{ afterLine: 99, size: 2 }]);

        expect(sketch(state)).toBe("0 1 · ·");
    });

    it("the zones it keeps: an empty one is dropped, an anchor past the end comes to the last line", () => {
        const state = makeState("a\nb");
        state.setViewZones([
            { afterLine: 0, size: 0 },
            { afterLine: 99, size: 2 },
        ]);

        expect(state.viewZones).toEqual([{ afterLine: 1, size: 2 }]);
    });

    it("several zones and merging of equal anchors", () => {
        const state = makeState("a\nb\nc");
        state.setViewZones([
            { afterLine: 1, size: 1 },
            { afterLine: 0, size: 1 },
            { afterLine: 1, size: 2 },
        ]);

        expect(sketch(state)).toBe("0 · 1 · · · 2");
        expect(state.viewZones).toEqual([
            { afterLine: 0, size: 1 },
            { afterLine: 1, size: 3 },
        ]);
    });

    it("empty zones are dropped, an empty set restores 1:1", () => {
        const state = makeState("a\nb");
        state.setViewZones([{ afterLine: 0, size: 0 }]);
        expect(sketch(state)).toBe("0 1");

        state.setViewZones([{ afterLine: 0, size: 1 }]);
        state.setViewZones([]);
        expect(sketch(state)).toBe("0 1");
    });

    it("viewLineKind distinguishes document, virtual and past-the-end lines", () => {
        const state = makeState("a\nb");
        state.setViewZones([{ afterLine: 0, size: 1 }]);

        expect(state.viewLineKind(0)).toBe("doc");
        expect(state.viewLineKind(1)).toBe("zone");
        expect(state.viewLineKind(2)).toBe("doc");
        expect(state.viewLineKind(3)).toBe("none");
        expect(state.viewLineKind(-1)).toBe("none");
    });

    it("visualToLogicalLine on a zone is -1, getViewLine is an empty string", () => {
        const state = makeState("alpha\nbravo");
        state.setViewZones([{ afterLine: 0, size: 1 }]);

        expect(state.visualToLogicalLine(1)).toBe(-1);
        expect(state.getViewLine(1)).toBe("");
        expect(state.getViewLineTokens(1)).toBeUndefined();
        expect(state.getViewLine(2)).toBe("bravo");
    });

    it("logicalToVisualLine accounts for zones and guards against a negative argument", () => {
        const state = makeState("a\nb\nc");
        state.setViewZones([{ afterLine: 0, size: 2 }]);

        expect(state.logicalToVisualLine(1)).toBe(3);
        expect(state.logicalToVisualLine(-1)).toBe(-1);
        expect(state.logicalToVisualLine(-2)).toBe(-1);
    });

    it("docLineForViewLine: the line itself, the anchor for a zone, the first line for a zone before start", () => {
        const state = makeState("a\nb\nc");
        state.setViewZones([
            { afterLine: -1, size: 1 },
            { afterLine: 1, size: 2 },
        ]);
        // View: · 0 1 · · 2

        expect(state.docLineForViewLine(1)).toBe(0);
        expect(state.docLineForViewLine(3)).toBe(1);
        expect(state.docLineForViewLine(4)).toBe(1);
        expect(state.docLineForViewLine(0)).toBe(0);
        expect(state.docLineForViewLine(99)).toBe(2);
        expect(state.docLineForViewLine(-5)).toBe(0);
    });

    it("zoneAnchorForViewLine: anchor for a zone, null for a document line and past the end", () => {
        const state = makeState("a\nb");
        state.setViewZones([{ afterLine: 0, size: 1 }]);

        expect(state.zoneAnchorForViewLine(1)).toBe(0);
        expect(state.zoneAnchorForViewLine(0)).toBeNull();
        expect(state.zoneAnchorForViewLine(99)).toBeNull();
        expect(state.zoneAnchorForViewLine(-1)).toBeNull();
    });

    it("zoneRowForViewLine: anchor and row offset inside a multi-line zone", () => {
        const state = makeState("a\nb\nc");
        state.setViewZones([
            { afterLine: -1, size: 2 },
            { afterLine: 1, size: 3 },
        ]);
        // View: · · 0 1 · · · 2

        expect(state.zoneRowForViewLine(0)).toEqual({ anchor: -1, offset: 0 });
        expect(state.zoneRowForViewLine(1)).toEqual({ anchor: -1, offset: 1 });
        expect(state.zoneRowForViewLine(4)).toEqual({ anchor: 1, offset: 0 });
        expect(state.zoneRowForViewLine(6)).toEqual({ anchor: 1, offset: 2 });
        expect(state.zoneRowForViewLine(2)).toBeNull();
        expect(state.zoneRowForViewLine(99)).toBeNull();
        expect(state.zoneRowForViewLine(-1)).toBeNull();
    });

    it("zoneRowForViewLine: offset counts from the zone's first line, also after folding the anchor", () => {
        const lines = Array.from({ length: 10 }, (_, i) => `l${String(i)}`).join("\n");
        const state = makeState(lines);
        state.setFoldingRegions([{ startLine: 1, endLine: 5, isCollapsed: true }]);
        // The anchor is hidden by a fold — the zone survives after the region header.
        state.setViewZones([{ afterLine: 3, size: 2 }]);
        // View: 0 1 · · 6 7 8 9

        expect(state.zoneRowForViewLine(2)).toEqual({ anchor: 3, offset: 0 });
        expect(state.zoneRowForViewLine(3)).toEqual({ anchor: 3, offset: 1 });
    });

    it("docLineForViewLine steps over a multi-line zone before start of file", () => {
        const state = makeState("a\nb");
        state.setViewZones([{ afterLine: -1, size: 2 }]);
        // View: · · 0 1 — the nearest document line below, through the zone's second line.

        expect(state.docLineForViewLine(0)).toBe(0);
    });
});

describe("EditorViewState view zones — event and cache", () => {
    it("setViewZones fires onDidChangeView once; repeating the same set is silent", () => {
        const state = makeState("a\nb");
        let fired = 0;
        state.onDidChangeView(() => {
            fired++;
        });

        state.setViewZones([{ afterLine: 0, size: 1 }]);
        expect(fired).toBe(1);

        state.setViewZones([{ afterLine: 0, size: 1 }]);
        expect(fired).toBe(1);

        state.setViewZones([{ afterLine: 0, size: 2 }]);
        expect(fired).toBe(2);
        state.setViewZones([]);
        expect(fired).toBe(3);
    });

    it("changing zones invalidates the projection cache with an unchanged document", () => {
        const state = makeState("a\nb\nc");
        expect(state.getViewLineCount()).toBe(3);

        state.setViewZones([{ afterLine: 0, size: 4 }]);
        expect(state.getViewLineCount()).toBe(7);

        state.setViewZones([{ afterLine: 0, size: 1 }]);
        expect(state.getViewLineCount()).toBe(4);
    });
});

describe("EditorViewState view zones × folding", () => {
    it("a zone on a hidden anchor survives after the header of the collapsed region", () => {
        const state = makeState("h\nb1\nb2\ntail");
        state.setFoldingRegions([{ startLine: 0, endLine: 2, isCollapsed: true }]);
        state.setViewZones([{ afterLine: 1, size: 1 }]);

        // View: header 0 (body 1-2 hidden), the zone after it, then 3.
        expect(sketch(state)).toBe("0 · 3");
    });

    it("unfolding returns the zone to its anchor", () => {
        const state = makeState("h\nb1\nb2\ntail");
        state.setFoldingRegions([{ startLine: 0, endLine: 2, isCollapsed: true }]);
        state.setViewZones([{ afterLine: 1, size: 1 }]);
        state.toggleFold(0);

        expect(sketch(state)).toBe("0 1 · 2 3");
    });
});

describe("EditorViewState view zones — cursor", () => {
    it("zones at file edges: the cursor on edge lines does not move", () => {
        const state = makeState("a\nb");
        state.setViewZones([
            { afterLine: -1, size: 1 },
            { afterLine: 1, size: 1 },
        ]);
        // View: · 0 1 ·

        state.selections = [createCursorSelection(0, 0)];
        state.cursorUp();
        expect(state.selections[0].active.line).toBe(0);

        state.selections = [createCursorSelection(1, 0)];
        state.cursorDown();
        expect(state.selections[0].active.line).toBe(1);
    });

    it("cursorDown/Up skip a zone: the cursor does not land on a virtual line", () => {
        const state = makeState("a\nb\nc");
        state.setViewZones([{ afterLine: 0, size: 3 }]);
        state.selections = [createCursorSelection(0, 0)];

        state.cursorDown();
        expect(state.selections[0].active.line).toBe(1);

        state.cursorUp();
        expect(state.selections[0].active.line).toBe(0);
    });

    it("PageDown steps by view lines: zones eat the page, as on screen", () => {
        const state = makeState(Array.from({ length: 20 }, (_, i) => `l${String(i)}`).join("\n"));
        state.viewportHeight = 6; // pageSize 5
        state.setViewZones([{ afterLine: 1, size: 3 }]);
        state.selections = [createCursorSelection(0, 0)];

        state.cursorPageDown();
        // View: 0 1 · · · 2 3 …; page = 5 view lines → view 5 → doc 2.
        expect(state.selections[0].active.line).toBe(2);

        state.cursorPageUp();
        expect(state.selections[0].active.line).toBe(0);
    });

    it("PageDown with a target on a zone lands on the nearest document line", () => {
        const state = makeState(Array.from({ length: 10 }, (_, i) => `l${String(i)}`).join("\n"));
        state.viewportHeight = 4; // pageSize 3
        state.setViewZones([{ afterLine: 2, size: 2 }]);
        state.selections = [createCursorSelection(0, 0)];

        state.cursorPageDown();
        // View: 0 1 2 · · 3 …; target view 3 is a zone → nearest document line 2.
        expect(state.selections[0].active.line).toBe(2);
    });

    it("PageUp/Down without zones behave as before", () => {
        const state = makeState(Array.from({ length: 12 }, (_, i) => `l${String(i)}`).join("\n"));
        state.viewportHeight = 5; // pageSize 4
        state.selections = [createCursorSelection(0, 0)];

        state.cursorPageDown();
        expect(state.selections[0].active.line).toBe(4);
        state.cursorPageDown();
        expect(state.selections[0].active.line).toBe(8);
        state.cursorPageUp();
        expect(state.selections[0].active.line).toBe(4);
    });

    it("revealPosition counts in view lines — zones above the cursor are accounted for", () => {
        const state = makeState(Array.from({ length: 30 }, (_, i) => `l${String(i)}`).join("\n"));
        state.viewportHeight = 5;
        state.setViewZones([{ afterLine: 0, size: 10 }]);

        state.goToPosition(20, 0);
        // Cursor on doc 20 = view 30; the viewport must follow.
        const caretView = state.logicalToVisualLine(20);
        expect(caretView).toBe(30);
        expect(state.scrollTop).toBeGreaterThan(caretView - state.viewportHeight);
        expect(state.scrollTop).toBeLessThanOrEqual(caretView);
    });

    describe("reveal with a zone right above the line", () => {
        function setup(zoneSize: number, margin: number): EditorViewState {
            const state = makeState(Array.from({ length: 40 }, (_, i) => `l${String(i)}`).join("\n"));
            state.viewportHeight = 5;
            state.cursorSurroundingLines = margin;
            state.setViewZones([{ afterLine: 9, size: zoneSize }]);
            return state;
        }

        it("coming from below, the zone comes into view over its line, past the margin", () => {
            const state = setup(1, 1);
            state.scrollTop = 20;
            state.goToPosition(10, 0);
            expect(state.scrollTop).toBe(9);
        });

        it("a zone taller than the viewport gives way to the line: its last rows are shown", () => {
            const state = setup(10, 0);
            state.scrollTop = 30;
            state.goToPosition(10, 0);
            expect(state.scrollTop).toBe(16);
        });

        it("the margin stays under the line, and a repeated reveal does not move", () => {
            const state = setup(10, 1);
            state.scrollTop = 30;
            state.goToPosition(10, 0);
            expect(state.scrollTop).toBe(17);
            state.goToPosition(10, 0);
            expect(state.scrollTop).toBe(17);
        });
    });
});

describe("EditorViewState — hidden cursor at the edge (indirection regression)", () => {
    it("cursorDown from a hidden line of a trailing region stays in place", () => {
        const state = makeState("a\nh\nb1\nb2");
        state.setFoldingRegions([{ startLine: 1, endLine: 3, isCollapsed: true }]);
        // The selections setter doesn't fix a hidden cursor (reconcile does that after
        // fold commands) — this is the moment between collapsing and fixing.
        state.selections = [createCursorSelection(2, 0)];

        state.cursorDown();

        expect(state.selections[0].active.line).toBe(2);
    });
});

describe("EditorViewState view zones — document edits", () => {
    it("an own edit above the anchor shifts the zone", () => {
        const state = makeState("a\nb\nc");
        state.setViewZones([{ afterLine: 1, size: 1 }]);
        state.selections = [createCursorSelection(0, 1)];

        state.type("\n");
        expect(state.viewZones).toEqual([{ afterLine: 2, size: 1 }]);
        expect(sketch(state)).toBe("0 1 2 · 3");
    });

    it("an edit below the anchor leaves the zone untouched", () => {
        const state = makeState("a\nb\nc");
        state.setViewZones([{ afterLine: 0, size: 1 }]);
        state.selections = [createCursorSelection(2, 1)];

        state.type("\n");
        expect(state.viewZones).toEqual([{ afterLine: 0, size: 1 }]);
    });

    it("deleting lines with the anchor clamps the anchor into the new range", () => {
        const state = makeState("a\nb\nc\nd\ne");
        state.setViewZones([{ afterLine: 2, size: 1 }]);
        state.selections = [{ anchor: { line: 1, character: 0 }, active: { line: 4, character: 0 } }];
        state.deleteLeft();

        const zones = state.viewZones;
        expect(zones).toHaveLength(1);
        expect(zones[0].afterLine).toBeLessThanOrEqual(1);
        expect(state.getViewLineCount()).toBe(2 + zones[0].size);
    });

    it("an edit whose clamp does not move the anchor keeps the zone as the same object", () => {
        const state = makeState("a\nb\nc\nd");
        state.setViewZones([{ afterLine: 1, size: 1 }]);
        const before = state.viewZones[0];
        // Deleting range [1..2): editStartLine 1, anchor clamp 1 → 1.
        state.selections = [{ anchor: { line: 1, character: 0 }, active: { line: 2, character: 0 } }];
        state.deleteLeft();

        expect(state.viewZones[0].afterLine).toBe(before.afterLine);
        expect(state.viewZones[0].size).toBe(1);
    });

    it("a foreign edit (remap) above the viewport does not move scrollTop with zones", () => {
        const doc = new TextDocument(Array.from({ length: 30 }, (_, i) => `l${String(i)}`).join("\n"));
        const state = new EditorViewState(doc, [createCursorSelection(20, 0)]);
        state.viewportHeight = 5;
        state.scrollTop = 15;
        state.setViewZones([{ afterLine: 25, size: 1 }]);

        // Foreign edit: a line inserted at the start (bypassing this view state's mutators).
        doc.applyEdits([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "x\n" }]);

        // Guard: with zones the logical shift ≠ the visual one — scroll is left alone.
        expect(state.scrollTop).toBe(15);
        expect(state.viewZones).toEqual([{ afterLine: 26, size: 1 }]);
    });
});
