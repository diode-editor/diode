import type { Uri } from "../../../base/common/uri.ts";
import { createRange } from "../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../editor/common/core/iTextEdit.ts";
import type { ILanguageService } from "../../../editor/common/languages/iLanguageService.ts";
import type { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";

import { BaseTextEditorModel } from "./textEditorModel.ts";

/**
 * Буфер, содержимое которого даёт **владелец**, а не файловая система: Output-канал
 * (`output:<channel>`), виртуальный документ расширения (`jdt:`), снимочная
 * сторона диффа (git-ревизия, буфер обмена, диск). Аналог upstream: голый
 * `ITextModel` из `IModelService.createModel` — без сохранения, кодировки,
 * слежения за диском и «несохранённых изменений»: у такого ресурса нет диска.
 */
export class SyntheticTextModel extends BaseTextEditorModel {
    /** Язык задаётся явно: выводить его из «пути» вида `output:extensions` нечем. */
    public constructor(
        languageService: ILanguageService,
        undoRedoService: UndoRedoService,
        uri: Uri,
        languageId: string,
    ) {
        super(languageService, undoRedoService, uri);
        this.doc.setLanguage(languageId);
    }

    /**
     * Дописывает текст в конец буфера от имени владельца.
     *
     * Идёт мимо `EditorViewState`, в отличие от {@link applyExternalEdits}, и это
     * намеренно: там стоит read-only-гард, а владелец писать обязан. Это ровно
     * разделение VS Code — `OutputChannelModel` пишет в `ITextModel`, а `readOnly`
     * живёт на виджете редактора и правки владельца не касается.
     *
     * API специально **только append**: правка в самом конце документа не сдвигает
     * ни выделения, ни фолды выше неё. Произвольные правки так проводить нельзя —
     * для них {@link applyExternalEdits}.
     */
    public appendContent(text: string): void {
        if (text.length === 0) return;
        const line = this.doc.lineCount - 1;
        const column = this.doc.getLineLength(line);
        this.doc.applyEdits([createTextEdit(createRange(line, column, line, column), text)]);
        // Правка владельца не пачкает буфер: «несохранённых изменений» у ресурса
        // без диска не бывает.
        this.markSaved();
        this.broadcastMarkDirty();
    }

    /** Заменяет содержимое целиком (смена Output-канала, свежий снимок, onDidChange провайдера). */
    public replaceContent(text: string): void {
        this.replaceText(text);
    }
}
