import type { Uri } from "../../../base/common/uri.ts";
import { createRange } from "../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../editor/common/core/iTextEdit.ts";
import type { ILanguageService } from "../../../editor/common/languages/iLanguageService.ts";
import type { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";

import { BaseTextEditorModel } from "./textEditorModel.ts";

/**
 * Содержимое даёт владелец (Output-канал, виртуальный документ, снимочная сторона
 * диффа), а не диск. Как голый `ITextModel` из `IModelService.createModel` эталона.
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
     * Мимо `EditorViewState` намеренно: там read-only-гард, а владелец писать обязан
     * (как `OutputChannelModel` vscode). Только append: правка в конце не сдвигает
     * выделения и фолды — произвольные правки идут через {@link applyExternalEdits}.
     */
    public appendContent(text: string): void {
        if (text.length === 0) return;
        const line = this.doc.lineCount - 1;
        const column = this.doc.getLineLength(line);
        this.doc.applyEdits([createTextEdit(createRange(line, column, line, column), text)]);
        // У ресурса без диска «несохранённых изменений» не бывает.
        this.markSaved();
        this.broadcastMarkDirty();
    }

    public replaceContent(text: string): void {
        this.replaceText(text);
    }
}
