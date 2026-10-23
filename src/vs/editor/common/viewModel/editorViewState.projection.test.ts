import { describe, expect, it } from "vitest";

import type { IFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import { createRange } from "../core/iRange.ts";
import { createCursorSelection } from "../core/iSelection.ts";
import { createTextEdit } from "../core/iTextEdit.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

/** Every row as `line` or `line@offset`, `·` for a zone row. */
function sketch(state: EditorViewState): string {
    const parts: string[] = [];
    for (let row = 0; row < state.getViewLineCount(); row++) {
        const line = state.visualToLogicalLine(row);
        if (line < 0) {
            parts.push("·");
            continue;
        }
        const { start } = state.viewLineRange(row);
        parts.push(start === 0 ? String(line) : `${String(line)}@${String(start)}`);
    }
    return parts.join(" ");
}

function region(startLine: number, endLine: number, isCollapsed = true): IFoldingRegion {
    return { startLine, endLine, isCollapsed };
}

function lines(count: number, prefix = "line"): string {
    const out: string[] = [];
    for (let i = 0; i < count; i++) out.push(`${prefix}${String(i)}`);
    return out.join("\n");
}

describe("EditorViewState projection — edits with collapsed folds", () => {
    it("a foreign edit inside a collapsed body keeps it hidden and shifts the lines below", () => {
        const doc = new TextDocument(lines(6));
        const state = new EditorViewState(doc);
        state.setFoldingRegions([region(1, 3)]);
        expect(sketch(state)).toBe("0 1 4 5");

        doc.applyEdits([createTextEdit(createRange(2, 0, 2, 0), "a\nb\n")]);
        expect(sketch(state)).toBe("0 1 6 7");
        expect(state.logicalToVisualLine(4)).toBe(-1);
        expect(state.logicalToVisualLine(6)).toBe(2);
    });

    it("deleting the header of a collapsed fold reveals its body", () => {
        const doc = new TextDocument(lines(6));
        const state = new EditorViewState(doc);
        state.setFoldingRegions([region(1, 3)]);
        expect(state.getViewLineCount()).toBe(4);

        doc.applyEdits([createTextEdit(createRange(1, 0, 2, 0), "")]);
        expect(sketch(state)).toBe("0 1 2 3 4");
    });

    it("typing on the line after a collapsed body keeps the rows in sync", () => {
        const doc = new TextDocument(lines(6));
        const state = new EditorViewState(doc);
        state.setFoldingRegions([region(0, 2)]);
        state.selections = [createCursorSelection(3, 0)];
        state.type("x\ny\n");
        expect(sketch(state)).toBe("0 3 4 5 6 7");
        expect(state.selections[0].active).toEqual({ line: 5, character: 0 });
    });

    it("a fold recompute that keeps the collapsed set after an edit changes nothing", () => {
        const doc = new TextDocument(lines(6));
        const state = new EditorViewState(doc);
        state.setFoldingRegions([region(1, 3)]);
        state.selections = [createCursorSelection(4, 0)];
        state.type("\n");
        expect(sketch(state)).toBe("0 1 4 5 6");

        // Fresh region objects with the same collapsed body, as the folding recompute produces them.
        state.setFoldingRegions([region(1, 3), region(4, 6, false)]);
        expect(sketch(state)).toBe("0 1 4 5 6");
    });

    it("a fold recompute that moves the collapsed body after an edit is applied", () => {
        const doc = new TextDocument(lines(6));
        const state = new EditorViewState(doc);
        state.setFoldingRegions([region(1, 3)]);
        state.selections = [createCursorSelection(4, 0)];
        state.type("\n");

        state.setFoldingRegions([region(1, 4)]);
        expect(sketch(state)).toBe("0 1 5 6");
        state.setFoldingRegions([region(0, 1)]);
        expect(sketch(state)).toBe("0 2 3 4 5 6");
    });

    it("edits that pile up while nobody asks for the view are all applied", () => {
        const doc = new TextDocument(lines(6));
        const state = new EditorViewState(doc);
        state.setFoldingRegions([region(1, 3)]);
        expect(state.getViewLineCount()).toBe(4);

        for (let i = 0; i < 40; i++) doc.applyEdits([createTextEdit(createRange(5, 0, 5, 0), "n\n")]);
        expect(state.getViewLineCount()).toBe(44);
        expect(state.visualToLogicalLine(43)).toBe(45);
    });

    it("a reload (flush) rebuilds from the new text", () => {
        const doc = new TextDocument(lines(6));
        const state = new EditorViewState(doc);
        state.setFoldingRegions([region(1, 3)]);
        expect(state.getViewLineCount()).toBe(4);

        doc.setText(lines(8, "fresh"));
        expect(sketch(state)).toBe("0 1 2 3 4 5 6 7");
    });

    it("removing the view zones after a frame drops their rows, with and without an edit", () => {
        const doc = new TextDocument(lines(4));
        const state = new EditorViewState(doc);
        state.setFoldingRegions([region(2, 3)]);
        state.setViewZones([{ afterLine: 0, size: 2 }]);
        expect(sketch(state)).toBe("0 · · 1 2");

        state.setViewZones([]);
        expect(sketch(state)).toBe("0 1 2");

        state.setViewZones([{ afterLine: 1, size: 1 }]);
        expect(sketch(state)).toBe("0 1 · 2");
        doc.applyEdits([createTextEdit(createRange(0, 0, 0, 0), "top\n")]);
        state.setViewZones([]);
        expect(sketch(state)).toBe("0 1 2 3");
    });

    it("unfolding everything after edits goes back to the 1:1 view", () => {
        const doc = new TextDocument(lines(5));
        const state = new EditorViewState(doc);
        state.setFoldingRegions([region(1, 3)]);
        doc.applyEdits([createTextEdit(createRange(4, 0, 4, 0), "tail\n")]);
        expect(state.getViewLineCount()).toBe(4);

        state.unfoldAll();
        expect(sketch(state)).toBe("0 1 2 3 4 5");
        expect(state.viewLineRange(5)).toEqual({ start: 0, end: 5 });
    });

    it("with wrap on, typing in a collapsed file re-wraps only the edited line", () => {
        const doc = new TextDocument("head\naaaa bbbb cccc\nhidden\ntail dddd eeee");
        const state = new EditorViewState(doc);
        state.viewportWidth = 10;
        state.wordWrap = "on";
        state.setFoldingRegions([region(1, 2)]);
        expect(sketch(state)).toBe("0 1 1@10 3 3@10");

        state.selections = [createCursorSelection(3, 14)];
        state.type(" ffff");
        expect(sketch(state)).toBe("0 1 1@10 3 3@10");
        state.type(" gggg");
        expect(sketch(state)).toBe("0 1 1@10 3 3@10 3@20");
        expect(state.viewLineRange(4)).toEqual({ start: 10, end: 20 });
    });
});

/** Deterministic PRNG (mulberry32): the run is reproducible from the seed printed on failure. */
function makeRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function cloneRegions(regions: readonly IFoldingRegion[]): IFoldingRegion[] {
    return regions.map((r) => ({ startLine: r.startLine, endLine: r.endLine, isCollapsed: r.isCollapsed }));
}

/** A fresh view over the same text and folds: built from scratch, it is the oracle for the in-place replay. */
function freshSketch(state: EditorViewState): string {
    const fresh = new EditorViewState(new TextDocument(state.document.getText()));
    fresh.viewportWidth = state.viewportWidth;
    fresh.wordWrap = state.wordWrap;
    fresh.tabSize = state.tabSize;
    fresh.setFoldingRegions(cloneRegions(state.foldedRegions));
    return sketch(fresh);
}

describe("EditorViewState projection — random edits match a rebuilt view", () => {
    const WORDS = ["alpha", "be", "gamma delta", "ee ff gg hh ii jj kk", "", "x", "longword_without_spaces_here"];

    function randomText(random: () => number, count: number): string {
        const out: string[] = [];
        for (let i = 0; i < count; i++) out.push(WORDS[Math.floor(random() * WORDS.length)]);
        return out.join("\n");
    }

    function randomRegions(random: () => number, lineCount: number): IFoldingRegion[] {
        const regions: IFoldingRegion[] = [];
        for (let start = 0; start < lineCount - 1; start += 1 + Math.floor(random() * 4)) {
            const end = Math.min(lineCount - 1, start + 1 + Math.floor(random() * 5));
            regions.push(region(start, end, random() < 0.4));
            if (random() < 0.3 && end - start > 2) regions.push(region(start + 1, end, random() < 0.5));
        }
        return regions;
    }

    for (const seed of [1, 2, 3]) {
        for (const wrap of ["off", "on"] as const) {
            it(`seed ${String(seed)}, wrap ${wrap}`, () => {
                const random = makeRandom(seed * 7919);
                const doc = new TextDocument(randomText(random, 30));
                const state = new EditorViewState(doc);
                state.viewportWidth = 8;
                state.wordWrap = wrap;
                state.setFoldingRegions(randomRegions(random, doc.lineCount));
                expect(sketch(state)).toBe(freshSketch(state));

                for (let step = 0; step < 80; step++) {
                    const op = random();
                    const line = Math.floor(random() * doc.lineCount);
                    if (op < 0.3) {
                        doc.applyEdits([
                            createTextEdit(
                                createRange(line, 0, line, 0),
                                randomText(random, 1 + Math.floor(random() * 3)) + "\n",
                            ),
                        ]);
                    } else if (op < 0.5) {
                        const endLine = Math.min(doc.lineCount - 1, line + Math.floor(random() * 3));
                        if (endLine === line && doc.lineCount === 1) continue;
                        const endChar = Math.floor(random() * (doc.getLineLength(endLine) + 1));
                        doc.applyEdits([createTextEdit(createRange(line, 0, endLine, endChar), "")]);
                    } else if (op < 0.75) {
                        const row = Math.floor(random() * state.getViewLineCount());
                        const target = state.visualToLogicalLine(row);
                        if (target < 0) continue;
                        state.selections = [
                            createCursorSelection(target, Math.floor(random() * (doc.getLineLength(target) + 1))),
                        ];
                        state.type(random() < 0.5 ? "zz " : "\n");
                    } else if (op < 0.9) {
                        const regions = state.foldedRegions;
                        if (regions.length > 0)
                            state.toggleFold(regions[Math.floor(random() * regions.length)].startLine);
                    } else {
                        state.setFoldingRegions(cloneRegions(state.foldedRegions));
                    }
                    // Not every step looks: pending edits must replay in order, several at a time.
                    if (random() < 0.7)
                        expect(sketch(state), `seed ${String(seed)} step ${String(step)}`).toBe(freshSketch(state));
                }
                expect(sketch(state)).toBe(freshSketch(state));
            });
        }
    }
});
