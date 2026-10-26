import { trimTrailingWhitespaceRanges } from "../../../../editor/common/commands/trimTrailingWhitespace.ts";
import { createInsertEdit, createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

export const trimTrailingWhitespaceAction: CommandAction = {
    id: "editor.action.trimTrailingWhitespace",
    title: "Trim Trailing Whitespace",
    when: "textInputFocus && !editorReadonly",
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (!editor) return;

        const trimInRegexAndStrings = accessor
            .get(IConfigurationServiceDIToken)
            .get("files.trimTrailingWhitespaceInRegexAndStrings", { overrideIdentifier: editor.languageId });
        const edits = trimTrailingWhitespaceRanges(
            editor.getText().split("\n"),
            trimInRegexAndStrings,
            editor.viewState.tokenStore,
        ).map((range) => createTextEdit(range, ""));
        editor.applyExternalEdits(edits, "Trim Trailing Whitespace");
    },
};

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
