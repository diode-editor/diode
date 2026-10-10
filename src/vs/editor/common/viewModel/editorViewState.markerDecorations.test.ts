import { describe, expect, it, vi } from "vitest";

import { MarkerSeverity } from "../../../platform/markers/common/iMarker.ts";
import { createRange } from "../core/iRange.ts";
import { createTextEdit } from "../core/iTextEdit.ts";
import { TextDocument } from "../model/textDocument.ts";

import { EditorViewState } from "./editorViewState.ts";

describe("EditorViewState — marker decorations", () => {
    it("отдаёт маркеры с серьёзностью и сдвинутым правкой диапазоном", () => {
        const doc = new TextDocument("let bad = 1;");
        const viewState = new EditorViewState(doc);
        viewState.setMarkerDecorations([
            { range: createRange(0, 4, 0, 7), severity: MarkerSeverity.Error },
            { range: createRange(0, 10, 0, 11), severity: MarkerSeverity.Hint },
        ]);
        doc.applyEdits([createTextEdit(createRange(0, 0, 0, 0), "  ")]);
        expect(viewState.getMarkerDecorations()).toEqual([
            { range: createRange(0, 6, 0, 9), severity: MarkerSeverity.Error },
            { range: createRange(0, 12, 0, 13), severity: MarkerSeverity.Hint },
        ]);
    });

    it("новый набор заменяет прежний, а не добавляется к нему", () => {
        const doc = new TextDocument("let bad = 1;");
        const viewState = new EditorViewState(doc);
        viewState.setMarkerDecorations([{ range: createRange(0, 4, 0, 7), severity: MarkerSeverity.Error }]);
        viewState.setMarkerDecorations([{ range: createRange(0, 0, 0, 3), severity: MarkerSeverity.Warning }]);
        expect(viewState.getMarkerDecorations()).toEqual([
            { range: createRange(0, 0, 0, 3), severity: MarkerSeverity.Warning },
        ]);
    });

    it("новый набор снимает из документа прежние декорации, а не копит их", () => {
        const doc = new TextDocument("let bad = 1;");
        const viewState = new EditorViewState(doc);
        const delta = vi.spyOn(doc, "deltaDecorations");
        viewState.setMarkerDecorations([{ range: createRange(0, 4, 0, 7), severity: MarkerSeverity.Error }]);
        const [firstIds] = delta.mock.results.map((result) => result.value as string[]);
        viewState.setMarkerDecorations([]);
        expect(delta.mock.calls[1][0]).toEqual(firstIds);
        expect(firstIds.map((id) => doc.getDecorationRange(id))).toEqual([null]);
    });

    it("две вью одного документа держат свои маркеры; dispose снимает только свои", () => {
        const doc = new TextDocument("let bad = 1;");
        const left = new EditorViewState(doc);
        const right = new EditorViewState(doc);
        left.setMarkerDecorations([{ range: createRange(0, 4, 0, 7), severity: MarkerSeverity.Error }]);
        right.setMarkerDecorations([{ range: createRange(0, 0, 0, 3), severity: MarkerSeverity.Warning }]);
        left.dispose();

        expect(left.getMarkerDecorations()).toEqual([]);
        expect(right.getMarkerDecorations()).toEqual([
            { range: createRange(0, 0, 0, 3), severity: MarkerSeverity.Warning },
        ]);
    });
});
