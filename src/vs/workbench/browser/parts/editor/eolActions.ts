import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { QuickInputServiceDIToken } from "../quickinput/quickInputService.ts";

/**
 * `when: "!editorReadonly"` у команд ниже — лишь декларация: клик по сегменту
 * статус-бара зовёт команду напрямую мимо `when`, поэтому read-only проверяем здесь —
 * иначе пикер в read-only открывался бы и молча ничего не делал.
 */
function setActiveEditorEol(accessor: Parameters<CommandAction["run"]>[0], eol: EndOfLine): void {
    const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
    if (editor === null || editor.readOnly) return;
    // Сегмент статус-бара подписан на onDidChangeEol и обновится сам.
    editor.setEol(eol);
}

export const convertToLfAction: CommandAction = {
    id: "workbench.action.editor.setEOL.lf",
    title: "End of Line: Convert to LF (\\n)",
    when: "!editorReadonly",
    run(accessor) {
        setActiveEditorEol(accessor, EndOfLine.LF);
    },
};

export const convertToCrlfAction: CommandAction = {
    id: "workbench.action.editor.setEOL.crlf",
    title: "End of Line: Convert to CRLF (\\r\\n)",
    when: "!editorReadonly",
    run(accessor) {
        setActiveEditorEol(accessor, EndOfLine.CRLF);
    },
};

/** VS Code `workbench.action.editor.changeEOL`. */
async function changeEol(accessor: ServiceAccessor): Promise<void> {
    const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
    if (editor === null || editor.readOnly) return;

    const picked = await accessor.get(QuickInputServiceDIToken).quickPick({
        title: "Change End of Line Sequence",
        placeholder: "Select End of Line Sequence",
        items: [
            { label: "LF", description: "\\n" },
            { label: "CRLF", description: "\\r\\n" },
        ],
        activeIndex: editor.eol === EndOfLine.CRLF ? 1 : 0,
    });
    if (picked === undefined) return;

    editor.setEol(picked.label === "CRLF" ? EndOfLine.CRLF : EndOfLine.LF);
}

export const changeEolAction: CommandAction = {
    id: "workbench.action.editor.changeEOL",
    title: "Change End of Line Sequence",
    when: "!editorReadonly",
    run(accessor) {
        void changeEol(accessor);
    },
};

export const toggleEolAction: CommandAction = {
    id: "workbench.action.editor.toggleEOL",
    title: "End of Line: Toggle LF / CRLF",
    when: "!editorReadonly",
    run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (editor === null || editor.readOnly) return;
        editor.setEol(editor.eol === EndOfLine.CRLF ? EndOfLine.LF : EndOfLine.CRLF);
    },
};
