import { createRange } from "../vs/editor/common/core/iRange.ts";
import type { ISelection } from "../vs/editor/common/core/iSelection.ts";
import type { TextFileModel } from "../vs/workbench/services/textfile/common/textFileModel.ts";

import { createEditorPane, type TextEditorPane } from "./TextEditorPaneFactory.ts";

/** A real pane with `text`, four spaces per indent unless told otherwise. */
export function snippetPane(text: string, indent: { insertSpaces?: boolean } = {}): TextEditorPane<TextFileModel> {
    const pane = createEditorPane();
    pane.setIndentOptions({ tabSize: 4, insertSpaces: indent.insertSpaces ?? true });
    pane.viewState.document.applyEdits([{ range: createRange(0, 0, 0, 0), text }]);
    return pane;
}

/** The pane's text with each selection drawn: `[` anchor, `]` active, `|` a caret. */
export function drawSelections(pane: TextEditorPane<TextFileModel>): string {
    const lines = pane.viewState.document.getText().split("\n");
    const marks = pane.viewState.selections.flatMap(({ anchor, active }: ISelection) =>
        anchor.line === active.line && anchor.character === active.character
            ? [{ ...active, mark: "|" }]
            : [
                  { ...anchor, mark: "[" },
                  { ...active, mark: "]" },
              ],
    );
    marks
        .sort((a, b) => b.line - a.line || b.character - a.character)
        .forEach(({ line, character, mark }) => {
            lines[line] = lines[line].slice(0, character) + mark + lines[line].slice(character);
        });
    return lines.join("\n");
}
