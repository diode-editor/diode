import type { Uri } from "../../../base/common/uri.ts";
import { createRange } from "../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../editor/common/core/iTextEdit.ts";
import type { ILanguageService } from "../../../editor/common/languages/iLanguageService.ts";
import type { UndoRedoService } from "../../../platform/undoRedo/common/undoRedoService.ts";

import { BaseTextEditorModel } from "./textEditorModel.ts";

/**
 * Content comes from the owner (an Output channel, a virtual document, the snapshot side of
 * a diff), not from disk. Like a bare `ITextModel` from upstream's `IModelService.createModel`.
 */
export class SyntheticTextModel extends BaseTextEditorModel {
    /** The language is explicit: there is nothing to infer it from in a "path" like `output:extensions`. */
    public constructor(
        languageService: ILanguageService,
        undoRedoService: UndoRedoService,
        uri: Uri,
        languageId: string,
    ) {
        super(languageService, undoRedoService, uri);
        this.doc.setLanguage(languageId);
    }

    private ownerIsWriting = false;

    /** The document sync reads the state inside the content event, before {@link replaceContent} returns. */
    public override get isModified(): boolean {
        return !this.ownerIsWriting && super.isModified;
    }

    /**
     * Bypasses `EditorViewState` on purpose: it has a read-only guard, but the owner must be able to write
     * (like vscode's `OutputChannelModel`). Append only: an edit at the end doesn't shift
     * selections and folds; arbitrary edits go through {@link applyExternalEdits}.
     */
    public appendContent(text: string): void {
        if (text.length === 0) return;
        const line = this.doc.lineCount - 1;
        const column = this.doc.getLineLength(line);
        this.doc.applyEdits([createTextEdit(createRange(line, column, line, column), text)]);
        // A resource without a disk backing never has unsaved changes.
        this.markSaved();
        this.broadcastMarkDirty();
    }

    /** The owner's text is the saved state: a provider's change leaves the document clean. */
    public replaceContent(text: string): void {
        this.ownerIsWriting = true;
        try {
            this.replaceText(text);
        } finally {
            this.ownerIsWriting = false;
        }
        this.markSaved();
    }
}
