import { findWordRangeAt } from "../../../../editor/common/core/wordClassification.ts";
import type { IRenameRequest } from "../../../../editor/common/languages/iRenameSource.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import type { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { showTransientNotice } from "../../../services/statusbar/common/transientNotice.ts";

import { prepareRename, renameSymbol } from "./renameSymbol.ts";

export const RenameServiceDIToken = token<RenameService>("RenameService");

/**
 * Rename Symbol (`editor.action.rename` / F2). Спрашивает у rename-провайдеров
 * реестра `ILanguageFeaturesService.renameProvider`, что переименовывается в
 * позиции каретки, просит новое имя через `QuickInputService.input` и отдаёт
 * переименование провайдеру — правки по всем затронутым файлам (в т.ч.
 * закрытым) накладывает bulk edit в субпроцессе через `workspace.applyEdit`,
 * одним шагом отмены.
 *
 * Поле ввода вместо inline-виджета эталона — вынужденное отступление: своего
 * rename-виджета у нас нет, а переиспользованный quick input даёт то же
 * (заполненное старым именем поле, Escape — отмена, Enter — применить).
 */
export class RenameService {
    public static dependencies = [
        EditorServiceDIToken,
        QuickInputServiceDIToken,
        StatusBarServiceDIToken,
        LanguageFeaturesServiceDIToken,
    ] as const;

    public constructor(
        private readonly group: EditorService,
        private readonly quickInput: QuickInputService,
        private readonly statusBar: StatusBarService,
        private readonly languageFeatures: ILanguageFeaturesService,
    ) {}

    /**
     * Переименовывает символ под кареткой активного редактора. Молчаливый
     * no-op, если редактора нет, провайдеров под документ нет либо
     * переименовывать здесь нечего: до вопроса «на что» дело не доходит, и
     * объяснять человеку нечего.
     */
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
            text,
            line: caret.line,
            character: caret.character,
        };

        // `prepareRename` — право провайдера сказать «здесь переименовать
        // нельзя» и назвать точное имя символа. Провайдера без него добираем
        // словом под кареткой — ровно то, что подставляет эталон, когда
        // prepareRename не реализован.
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
        // Отмена (Escape) и имя, не отличающееся от старого, — не событие.
        if (newName === undefined || newName === oldName) return;
        if (newName === "") {
            this.notice("Rename failed: the new name is empty");
            return;
        }

        // Запрос пересобираем из АКТУАЛЬНОГО текста: пока человек набирал имя,
        // документ мог уехать (авто-импорт, форматирование по сохранению), а
        // отправить провайдеру протухший снапшот значит переименовать не то.
        const live = this.group.getActiveEditor();
        const result = await renameSymbol(
            registry,
            editor,
            live?.uri.toString() === request.uri ? { ...request, text: live.getText() } : request,
            newName,
        );
        if (result.applied) return;
        // Провайдер молча не дал правок — переименовывать было нечего; это не
        // ошибка, и сообщения эталон в таком случае не показывает.
        if (result.error !== undefined) this.notice(`Rename failed: ${result.error}`);
    }

    private notice(text: string): void {
        showTransientNotice(this.statusBar, "rename.notice", text);
    }
}

/**
 * Фолбэк `prepareRename`: слово под кареткой как переименовываемый символ.
 * `null` — каретка не на слове (переименовывать нечего).
 */
function wordUnderCaret(text: string, line: number, character: number): string | null {
    const lineText = text.split("\n").at(line);
    if (lineText === undefined) return null;
    const word = findWordRangeAt(lineText, character);
    if (word === null) return null;
    return lineText.slice(word.start, word.end);
}
