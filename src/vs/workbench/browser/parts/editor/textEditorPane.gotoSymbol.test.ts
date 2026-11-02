import { describe, expect, it } from "vitest";

import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { IExternalDecorations } from "../../../../editor/common/model/iEditorDecoration.ts";

describe("TextEditorPane — what Go to Symbol needs", () => {
    it("setDecorations reaches the editor element", () => {
        const pane = createEditorPane();
        const decorations: IExternalDecorations = {
            lineBackgrounds: [{ startLine: 0, endLine: 0, colorToken: "editor.rangeHighlightBackground" }],
        };

        pane.setDecorations(decorations);

        const { editor } = pane.component as unknown as { editor: { decorations: IExternalDecorations } };
        expect(editor.decorations).toBe(decorations);
        pane.dispose();
    });

    it("versionId follows the document", () => {
        const pane = createEditorPane();
        const before = pane.versionId;

        pane.viewState.document.applyEdits([{ range: createRange(0, 0, 0, 0), text: "x" }]);

        expect(pane.versionId).toBeGreaterThan(before);
        pane.dispose();
    });
});
