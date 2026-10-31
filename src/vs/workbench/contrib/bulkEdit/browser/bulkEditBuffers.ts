import * as path from "node:path";

import { Uri } from "../../../../base/common/uri.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { IUndoRedoElement } from "../../../../platform/undoRedo/common/iUndoRedoElement.ts";
import type { IUndoParticipant } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import type { TextFileModel } from "../../../services/textfile/common/textFileModel.ts";
import type { TextFileModelService } from "../../../services/textfile/common/textFileModelService.ts";
import type { BulkEditTarget, IBulkEditBuffer, IBulkEditBuffers } from "../common/iBulkEditBuffers.ts";

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
            const uri = Uri.parse(resource);
            const model = this.models.get(uri);
            if (model === null) return null;
            if (model.isTooLargeForTokenization) return "read-only";
            // A document extensions opened without a tab is live. Otherwise the model belongs to someone else (a diff
            // side): there is no way to route the edit there, and writing past it is not allowed — buffer and file would diverge.
            return this.editors.getFileModelsWithoutEditor().includes(model) ? this.modelBuffer(model) : "read-only";
        }
        if (pane.readOnly) return "read-only";
        return {
            text: () => pane.getText(),
            applyEdits: (edits, label) => pane.applyExternalEditsDetached(edits, label),
            setEol: (eol) => pane.setEolDetached(eol),
            save: async () => {
                if (pane.isModified) await pane.save();
            },
        };
    }

    public open(resource: string): Exclude<BulkEditTarget, null> | null {
        const model = this.editors.holdFileModel(Uri.parse(resource));
        if (model === null) return null;
        // The large-file mode is read-only and not synced: an edit would resolve `true` while the extension sees nothing.
        return model.isTooLargeForTokenization ? "read-only" : this.modelBuffer(model);
    }

    public willDelete(resource: string): void {
        this.editors.revertSoftBeforeDelete(Uri.parse(resource));
    }

    public didReplaceOnDisk(resource: string): void {
        this.models.get(Uri.parse(resource))?.revertToDisk();
    }

    private modelBuffer(model: TextFileModel): IBulkEditBuffer {
        // The step outlives the model once it is saved and let go: undoing would edit a dead document.
        const guarded = (step: IUndoRedoElement | null): IUndoRedoElement | null => {
            if (step === null) return null;
            const alive = (): boolean => this.models.get(model.uri) === model;
            return {
                ...step,
                canUndo: () => alive() && (step.canUndo?.() ?? true),
                canRedo: () => alive() && (step.canRedo?.() ?? true),
            };
        };
        return {
            text: () => model.getText(),
            applyEdits: (edits, label) => {
                const step = model.applyExternalEditsDetached(edits, label);
                return step === null ? null : this.reopeningStep(model, step, edits, label);
            },
            setEol: (eol) => guarded(model.setEolDetached(eol)),
            save: async () => {
                if (model.isModified) await model.save();
            },
        };
    }

    /**
     * Undoing the step can let the model go (the file it created is removed, the tab closes). Redo has no model left
     * to replay on: it opens a new one over the file the step's file operation has just brought back.
     */
    private reopeningStep(
        model: TextFileModel,
        step: IUndoRedoElement,
        edits: readonly ITextEdit[],
        label: string,
    ): IUndoRedoElement {
        const uri = model.uri;
        let current = model;
        let currentStep = step;
        const alive = (): boolean => this.models.get(uri) === current;
        return {
            ...step,
            canUndo: () => alive() && (currentStep.canUndo?.() ?? true),
            canRedo: () => !alive() || (currentStep.canRedo?.() ?? true),
            undo: () => currentStep.undo(),
            redo: () => {
                if (alive()) return currentStep.redo();
                const reopened = this.editors.holdFileModel(uri);
                if (reopened === null) throw new Error(`No model for ${uri.toString()}`);
                current = reopened;
                currentStep = reopened.applyExternalEditsDetached(edits, label) ?? currentStep;
            },
        };
    }

    public undoParticipants(touched: readonly string[]): IUndoParticipant[] {
        const participants = new Map<string, IUndoParticipant>();
        let hasTab = false;
        for (const resource of touched) {
            const pane = this.paneFor(resource);
            // Split views of one document share the model, and with it the bucket.
            if (pane !== null && !participants.has(pane.undoContext)) {
                participants.set(pane.undoContext, { context: pane.undoContext, label: pane.label, owner: true });
            }
            hasTab ||= pane !== null;
            if (pane !== null) continue;
            // The model is loaded already, so a tab opened later won't adopt the step on load: it has to be there now.
            const model = this.models.get(Uri.parse(resource));
            if (model !== null) {
                const label = path.basename(model.uri.fsPath);
                participants.set(model.undoContext, { context: model.undoContext, label, owner: false });
            }
        }
        if (hasTab) return [...participants.values()];
        // None of the touched resources has a tab — anchor the step on the active tab: the action was invoked
        // from it. No tabs — the step goes to the workspace-operations bucket.
        const active = this.editors.getActiveTabEditor();
        if (active !== null) {
            participants.set(active.undoContext, { context: active.undoContext, label: active.label, owner: false });
        }
        return [...participants.values()];
    }

    public didDelete(resource: string): void {
        this.editors.handleDeletedFile(Uri.parse(resource));
    }

    /** The resource's active tab, if it is one: its view state is the effective one. */
    private paneFor(resource: string): TextEditorPane | null {
        const active = this.editors.getActiveTabEditor();
        if (active !== null && active.uri.toString() === resource) return active;
        return this.editors.getEditors().find((editor) => editor.uri.toString() === resource) ?? null;
    }
}
