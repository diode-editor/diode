import { findWordRangeAt } from "../../../../editor/common/core/wordClassification.ts";
import type { IRenameRequest } from "../../../../editor/common/languages/iRenameSource.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { showTransientNotice } from "../../../services/statusbar/common/transientNotice.ts";

import { prepareRename, renameSymbol } from "./renameSymbol.ts";

export const RenameServiceDIToken = token<RenameService>("RenameService");

/**
 * Новое имя — через `QuickInputService.input`, а не inline-виджет эталона: своего rename-виджета
 * нет, а quick input даёт то же (поле со старым именем, Escape — отмена, Enter — применить).
 */
export class RenameService {
    public static dependencies = [
        EditorServiceDIToken,
        QuickInputServiceDIToken,
        StatusBarServiceDIToken,
        LanguageFeaturesServiceDIToken,
    ] as const;

    public constructor(
        private readonly group: IEditorService,
        private readonly quickInput: QuickInputService,
        private readonly statusBar: StatusBarService,
        private readonly languageFeatures: ILanguageFeaturesService,
    ) {}

    public async rename(): Promise<void> {
        const editor = this.group.getActiveEditor();
        if (editor === null) return;
        const registry = this.languageFeatures.renameProvider;
        if (!registry.has(editor)) return;

        const caret = editor.viewState.selections[0].active;
        const text = editor.getText();
        const request: IRenameRequest = {
            uri: editor.uri.toString(),
            languageId: editor.languageId,
            versionId: editor.model.document.versionId,
            line: caret.line,
            character: caret.character,
        };

        // Провайдера без `prepareRename` добираем словом под кареткой — как эталон.
        const prepared = await prepareRename(registry, editor, request);
        if (prepared.rejectReason !== undefined) {
            this.notice(`Rename failed: ${prepared.rejectReason}`);
            return;
        }
        const oldName = prepared.name ?? wordUnderCaret(text, caret.line, caret.character);
        if (oldName === null) return;

        const newName = await this.quickInput.input({
            title: "Rename Symbol",
            prompt: "Enter the new name; Escape to cancel",
            value: oldName,
        });
        if (newName === undefined || newName === oldName) return;
        if (newName === "") {
            this.notice("Rename failed: the new name is empty");
            return;
        }

        // Запрос пересобираем на АКТУАЛЬНУЮ версию: пока человек набирал имя,
        // документ мог уехать (авто-импорт, форматирование по сохранению), а
        // запрос по протухшей версии субпроцесс отклонит как устаревший.
        const live = this.group.getActiveEditor();
        const result = await renameSymbol(
            registry,
            editor,
            live?.uri.toString() === request.uri ? { ...request, versionId: live.model.document.versionId } : request,
            newName,
        );
        // Отказ без причины — «переименовывать было нечего», эталон тоже молчит; причина и
        // успех взаимоисключающи, отдельной проверки `applied` не нужно.
        if (result.error !== undefined) this.notice(`Rename failed: ${result.error}`);
    }

    private notice(text: string): void {
        showTransientNotice(this.statusBar, "rename.notice", text);
    }
}

/** `null` — каретка не на слове. */
function wordUnderCaret(text: string, line: number, character: number): string | null {
    const lineText = text.split("\n").at(line);
    if (lineText === undefined) return null;
    const word = findWordRangeAt(lineText, character);
    if (word === null) return null;
    return lineText.slice(word.start, word.end);
}
