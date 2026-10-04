import { createDeleteEdit, createInsertEdit, type ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

// ─── Whitespace ─────────────────────────────────────────────
//
// Core editor commands that the editorconfig extension (and users) invoke via
// the command palette / executeCommand. They carry no default keybindings.

/**
 * Removes trailing spaces and tabs from every line of the active document.
 * Matches VS Code's `editor.action.trimTrailingWhitespace`.
 */
export const trimTrailingWhitespaceAction: CommandAction = {
    id: "editor.action.trimTrailingWhitespace",
    title: "Trim Trailing Whitespace",
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (!editor) return;

        const lines = editor.getText().split("\n");
        const edits: ITextEdit[] = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLength = line.replace(/[ \t]+$/, "").length;
            if (trimmedLength < line.length) {
                edits.push(createDeleteEdit(i, trimmedLength, i, line.length));
            }
        }
        editor.applyExternalEdits(edits, "Trim Trailing Whitespace");
    },
};

/**
 * Ensures the active document ends with exactly one final newline.
 * Matches VS Code's `editor.action.insertFinalNewLine`.
 */
export const insertFinalNewLineAction: CommandAction = {
    id: "editor.action.insertFinalNewLine",
    title: "Insert Final Newline",
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (!editor) return;

        const text = editor.getText();
        if (text.length === 0 || text.endsWith("\n")) return;

        const lines = text.split("\n");
        const lastLine = lines.length - 1;
        editor.applyExternalEdits([createInsertEdit(lastLine, lines[lastLine].length, "\n")], "Insert Final Newline");
    },
};
