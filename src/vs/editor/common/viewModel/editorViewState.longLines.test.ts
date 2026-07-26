import { describe, expect, it, vi } from "vitest";

import { STOP_RENDERING_LINE_AFTER } from "../../../../../tuidom/common/textLimits.ts";
import { createInsertEdit } from "../core/iTextEdit.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

describe("EditorViewState.hasLinesOverRenderCap", () => {
    it("is false for a document of normal lines", () => {
        const vs = new EditorViewState(new TextDocument("short\nlines\nhere"));
        expect(vs.hasLinesOverRenderCap()).toBe(false);
    });

    it("is false for a line exactly at the cap", () => {
        const vs = new EditorViewState(new TextDocument("a".repeat(STOP_RENDERING_LINE_AFTER)));
        expect(vs.hasLinesOverRenderCap()).toBe(false);
    });

    it("is true once a line exceeds the cap", () => {
        const vs = new EditorViewState(new TextDocument("a".repeat(STOP_RENDERING_LINE_AFTER + 1)));
        expect(vs.hasLinesOverRenderCap()).toBe(true);
    });

    it("detects a long line among normal ones", () => {
        const doc = new TextDocument(["one", "two", "x".repeat(STOP_RENDERING_LINE_AFTER + 100), "four"].join("\n"));
        expect(new EditorViewState(doc).hasLinesOverRenderCap()).toBe(true);
    });

    it("caches by versionId (no rescan without an edit)", () => {
        const doc = new TextDocument("short");
        const vs = new EditorViewState(doc);
        expect(vs.hasLinesOverRenderCap()).toBe(false);

        const getLineLength = vi.spyOn(doc, "getLineLength");
        vs.hasLinesOverRenderCap();
        vs.hasLinesOverRenderCap();
        expect(getLineLength).not.toHaveBeenCalled();
    });

    it("flips to true when a long line is appended (Output pattern)", () => {
        const doc = new TextDocument("first log line");
        const vs = new EditorViewState(doc);
        expect(vs.hasLinesOverRenderCap()).toBe(false);

        doc.applyEdits([createInsertEdit(0, 14, "\n" + "b".repeat(STOP_RENDERING_LINE_AFTER + 5))]);
        expect(vs.hasLinesOverRenderCap()).toBe(true);
    });
});
