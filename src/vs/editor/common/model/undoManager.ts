import type { EndOfLine } from "../core/endOfLine.ts";
import type { ISelection } from "../core/iSelection.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";

import type { ITextDocument } from "./iTextDocument.ts";
import type { IUndoElement } from "./iUndoElement.ts";

interface MutableUndoElement {
    label: string;
    versionBefore: number;
    versionAfter: number;
    forwardEdits: readonly ITextEdit[];
    backwardEdits: readonly ITextEdit[];
    beforeSelections: readonly ISelection[];
    afterSelections: readonly ISelection[];
    eolBefore?: EndOfLine;
    eolAfter?: EndOfLine;
}

/** Остальные вью документа ремапят состояние сами по `onDidChangeContent`. */
export interface IUndoViewBinding {
    restoreSelections(selections: readonly ISelection[]): void;
}

/**
 * Идентичность записи стека. Сравнивать по версии документа нельзя: `undo`
 * переписывает `versionAfter` следующего элемента, снятый снаружи снимок версии устаревает.
 */
export interface UndoStepToken {
    readonly label: string;
}

/**
 * Один на документ, а не на вью: иначе version-гейт в {@link undo} молча
 * отбрасывал бы шаги, сделанные «чужой» вью.
 */
export class UndoManager {
    private undoStack: MutableUndoElement[] = [];
    private redoStack: MutableUndoElement[] = [];
    private readonly doc: ITextDocument;

    public onDidPush: ((element: IUndoElement) => void) | null = null;

    public constructor(doc: ITextDocument) {
        this.doc = doc;
    }

    public clear(): void {
        this.undoStack = [];
        this.redoStack = [];
    }

    public get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    public get canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    public pushUndoElement(element: IUndoElement): void {
        this.undoStack.push({ ...element });
        this.redoStack.length = 0;
        this.onDidPush?.(element);
    }

    public peekUndoStep(): UndoStepToken | undefined {
        return this.undoStack.at(-1);
    }

    public peekRedoStep(): UndoStepToken | undefined {
        return this.redoStack.at(-1);
    }

    /** `undefined` — валидный аргумент и всегда `false`. */
    public canUndoStep(token: UndoStepToken | undefined): boolean {
        const top = this.undoStack.at(-1);
        return top !== undefined && top === token && this.doc.versionId === top.versionAfter;
    }

    public canRedoStep(token: UndoStepToken | undefined): boolean {
        const top = this.redoStack.at(-1);
        return top !== undefined && top === token && this.doc.versionId === top.versionAfter;
    }

    /** `view` — та, кому восстановить снимок выделений шага; остальные ремапят сами. */
    public undo(view: IUndoViewBinding | null = null): boolean {
        const element = this.undoStack.pop();
        if (!element) return false;

        if (this.doc.versionId !== element.versionAfter) {
            return false;
        }

        const { appliedVersion, inverseEdits } = this.doc.applyEdits(element.backwardEdits);
        view?.restoreSelections(element.beforeSelections);
        if (element.eolBefore !== undefined) {
            this.doc.setEol(element.eolBefore);
        }

        this.redoStack.push({
            label: element.label,
            versionBefore: element.versionAfter,
            versionAfter: appliedVersion,
            forwardEdits: element.backwardEdits,
            backwardEdits: inverseEdits,
            beforeSelections: element.afterSelections,
            afterSelections: element.beforeSelections,
            eolBefore: element.eolAfter,
            eolAfter: element.eolBefore,
        });

        if (this.undoStack.length > 0) {
            this.undoStack[this.undoStack.length - 1].versionAfter = appliedVersion;
        }

        return true;
    }

    public redo(view: IUndoViewBinding | null = null): boolean {
        const element = this.redoStack.pop();
        if (!element) return false;

        if (this.doc.versionId !== element.versionAfter) {
            return false;
        }

        const { appliedVersion, inverseEdits } = this.doc.applyEdits(element.backwardEdits);
        view?.restoreSelections(element.beforeSelections);
        if (element.eolBefore !== undefined) {
            this.doc.setEol(element.eolBefore);
        }

        this.undoStack.push({
            label: element.label,
            versionBefore: element.versionAfter,
            versionAfter: appliedVersion,
            forwardEdits: element.backwardEdits,
            backwardEdits: inverseEdits,
            beforeSelections: element.afterSelections,
            afterSelections: element.beforeSelections,
            eolBefore: element.eolAfter,
            eolAfter: element.eolBefore,
        });

        if (this.redoStack.length > 0) {
            this.redoStack[this.redoStack.length - 1].versionAfter = appliedVersion;
        }

        return true;
    }
}
