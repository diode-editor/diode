import { packRgb } from "@tuidom/all/common/colorUtils";
import type { StoryContext, StoryMeta } from "../../../StoryRunner/StoryTypes.ts";
import { TextDocument } from "../common/model/textDocument.ts";
import { EditorViewState } from "../common/viewModel/editorViewState.ts";

import { EditorElement } from "./editorElement.ts";

export const meta: StoryMeta = {
    title: "EditorElement",
};

export function withSampleText(ctx: StoryContext): void {
    const sampleText = `Hello, World!
Welcome to vexx — a TUI text editor.
Start typing to edit this document.

Line 5 is here.
And line 6.
Have fun!`;

    const doc = new TextDocument(sampleText);
    const viewState = new EditorViewState(doc);
    const editor = new EditorElement(viewState);
    editor.style = { fg: packRgb(212, 212, 212), bg: packRgb(30, 30, 30) };
    editor.setStyleVars({
        "editorGutter.background": packRgb(30, 30, 30),
        "editorLineNumber.foreground": packRgb(133, 133, 133),
        "editorLineNumber.activeForeground": packRgb(198, 198, 198),
    });
    ctx.body.setContent(editor);
}
