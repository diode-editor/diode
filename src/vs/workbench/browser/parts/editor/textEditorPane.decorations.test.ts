import { describe, expect, it } from "vitest";

import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import type { IExternalDecorations } from "../../../../editor/common/model/iEditorDecoration.ts";

describe("TextEditorPane.setDecorations", () => {
    it("reaches the editor element", () => {
        const pane = createEditorPane();
        const decorations: IExternalDecorations = {
            lineBackgrounds: [{ startLine: 0, endLine: 0, colorToken: "editor.rangeHighlightBackground" }],
        };

        pane.setDecorations(decorations);

        const { editor } = pane.component as unknown as { editor: { decorations: IExternalDecorations } };
        expect(editor.decorations).toBe(decorations);
        pane.dispose();
    });
});
