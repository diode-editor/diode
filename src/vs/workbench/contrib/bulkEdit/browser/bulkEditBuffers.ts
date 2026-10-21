import { Uri } from "../../../../base/common/uri.ts";
import type { IUndoParticipant } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import type { TextFileModelService } from "../../../services/textfile/common/textFileModelService.ts";
import type { BulkEditTarget, IBulkEditBuffers } from "../common/iBulkEditBuffers.ts";

export class BulkEditBuffers implements IBulkEditBuffers {
    private readonly editors: IEditorService;
    private readonly models: TextFileModelService;

    public constructor(editors: IEditorService, models: TextFileModelService) {
        this.editors = editors;
        this.models = models;
    }

    public get(resource: string): BulkEditTarget {
        const pane = this.paneFor(resource);
        if (pane === null) {
            // Вкладки нет, но модель может жить в реестре (сторона диффа): провести правку туда
            // нечем, а писать на диск мимо неё нельзя — буфер и файл разъехались бы.
            return this.models.get(Uri.parse(resource)) === null ? null : "read-only";
        }
        if (pane.readOnly) return "read-only";
        return {
            text: () => pane.getText(),
            applyEdits: (edits, label) => pane.applyExternalEditsDetached(edits, label),
            save: async () => {
                if (pane.isModified) await pane.save();
            },
        };
    }

    public undoParticipants(touched: readonly string[]): IUndoParticipant[] {
        const participants = new Map<string, IUndoParticipant>();
        for (const resource of touched) {
            const pane = this.paneFor(resource);
            // Сплит-вью одного документа делят модель, а с ней и бакет.
            if (pane !== null && !participants.has(pane.undoContext)) {
                participants.set(pane.undoContext, { context: pane.undoContext, label: pane.label, owner: true });
            }
        }
        if (participants.size > 0) return [...participants.values()];
        // Ни один тронутый ресурс не открыт — якорим шаг на активной вкладке: действие вызвали
        // из неё. Вкладок нет — шаг уйдёт в бакет workspace-операций.
        const active = this.editors.getActiveTabEditor();
        return active === null ? [] : [{ context: active.undoContext, label: active.label, owner: false }];
    }

    public didDelete(resource: string): void {
        this.editors.handleDeletedFile(Uri.parse(resource));
    }

    /** Активная вкладка ресурса, если это она: её view-state и есть действующая. */
    private paneFor(resource: string): TextEditorPane | null {
        const active = this.editors.getActiveTabEditor();
        if (active !== null && active.uri.toString() === resource) return active;
        return this.editors.getEditors().find((editor) => editor.uri.toString() === resource) ?? null;
    }
}
