import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../platform/actions/common/menuId.ts";
import { inMemoryClipboardMetadata } from "../../../platform/clipboard/common/clipboardMetadata.ts";
import { IConfigurationServiceDIToken } from "../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { parseKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import type { ServiceAccessor } from "../../../platform/instantiation/common/diContainer.ts";
import { ClipboardDIToken } from "../../common/coreTokens.ts";
import { EditorServiceDIToken } from "../../services/editor/browser/editorService.ts";

/** `editor.emptySelectionClipboard`: копирует ли Copy/Cut без выделения текущую строку. */
function isEmptySelectionClipboardEnabled(accessor: ServiceAccessor): boolean {
    return accessor.get(IConfigurationServiceDIToken).get<boolean>("editor.emptySelectionClipboard") ?? true;
}

export const clipboardCopyAction: CommandAction = {
    id: "editor.action.clipboardCopyAction",
    title: "Copy",
    keybinding: parseKeybinding("ctrl+c"),
    // Шире, чем у Cut/Paste: копировать можно и из read-only диффа.
    when: "textViewFocus",
    menus: [
        { menuId: MenuId.EditorContext, group: "1_clipboard", order: 10 },
        { menuId: MenuId.MenubarEditMenu, group: "2_clipboard", order: 20 },
    ],
    async run(accessor) {
        // Через панель, а не через viewState: что считать выделенным, решает
        // она (дифф выбрасывает строки-плейсхолдеры свёрнутых кусков).
        const editorService = accessor.get(EditorServiceDIToken);
        const text = joinSelectedTexts(editorService.getActivePane()?.getSelectedTexts() ?? []);
        if (text !== "") {
            await accessor.get(ClipboardDIToken).writeText(text);
            // Stryker disable next-line ObjectLiteral: пустой объект эквивалентен — отсутствующий isFromEmptySelection читается как false
            inMemoryClipboardMetadata.set(text, { isFromEmptySelection: false });
            return;
        }
        // Пусто — `emptySelectionClipboard`: копия строк(и) под каретками.
        // viewState, а не панель: работает и на read-only стороне диффа.
        const viewState = editorService.getActiveViewState();
        if (!viewState || !isEmptySelectionClipboardEnabled(accessor)) return;
        // Выделений без панели не бывает, а пустые каретки всегда несут свою
        // строку с \n — текст непуст by construction.
        const lineCopy = viewState.getTextToCopy(true);
        await accessor.get(ClipboardDIToken).writeText(lineCopy.text);
        inMemoryClipboardMetadata.set(lineCopy.text, { isFromEmptySelection: lineCopy.isFromEmptySelection });
    },
};

/**
 * Текст для буфера из выделений мультикурсора: непустые куски в документном порядке,
 * склеенные переводом строки (семантика VS Code). Схлопнутые каретки пропускаются — они
 * ничего не выделяют, и пустая строка в буфере была бы мусором.
 */
function joinSelectedTexts(texts: readonly string[]): string {
    return texts.filter((text) => text !== "").join("\n");
}

export const clipboardCutAction: CommandAction = {
    id: "editor.action.clipboardCutAction",
    title: "Cut",
    keybinding: parseKeybinding("ctrl+x"),
    when: "textInputFocus && !editorReadonly",
    menus: [
        { menuId: MenuId.EditorContext, group: "1_clipboard", order: 20 },
        { menuId: MenuId.MenubarEditMenu, group: "2_clipboard", order: 10 },
    ],
    async run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (!editor) return;
        const emptySelectionClipboard = isEmptySelectionClipboardEnabled(accessor);
        // Один источник для «что копируем» и «что удаляем»: пустые каретки при
        // включённой настройке уносят в буфер свою строку целиком и её же режут.
        const copy = editor.viewState.getTextToCopy(emptySelectionClipboard);
        if (copy.text === "") return;
        await accessor.get(ClipboardDIToken).writeText(copy.text);
        inMemoryClipboardMetadata.set(copy.text, { isFromEmptySelection: copy.isFromEmptySelection });
        editor.pushUndo(editor.viewState.cutSelections(emptySelectionClipboard));
    },
};

export const clipboardPasteAction: CommandAction = {
    id: "editor.action.clipboardPasteAction",
    title: "Paste",
    keybinding: parseKeybinding("ctrl+v"),
    when: "textInputFocus && !editorReadonly",
    menus: [
        { menuId: MenuId.EditorContext, group: "1_clipboard", order: 30 },
        { menuId: MenuId.MenubarEditMenu, group: "2_clipboard", order: 30 },
    ],
    async run(accessor) {
        const editor = accessor.get(EditorServiceDIToken).getActiveEditor();
        if (!editor) return;
        const text = await accessor.get(ClipboardDIToken).readText();
        if (text === "") return;
        // Линейная вставка: строка, скопированная пустым выделением, ложится
        // строкой выше курсорной. Метаданные валидны только для текста,
        // записанного НАШИМ последним Copy/Cut — чужой буфер вставляется как есть.
        const pasteOnNewLine =
            (inMemoryClipboardMetadata.get(text)?.isFromEmptySelection ?? false) &&
            isEmptySelectionClipboardEnabled(accessor);
        editor.pushUndo(editor.viewState.pasteText(text, pasteOnNewLine));
    },
};
