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

/**
 * «Действующая вью» шага undo/redo — та, в которую восстанавливается снимок
 * выделений из элемента истории. Остальные вью документа своё состояние
 * ремапят сами по `onDidChangeContent` (см. `EditorViewState`), поэтому
 * менеджеру от вью нужен ровно один метод. `EditorViewState` подходит
 * структурно.
 */
export interface IUndoViewBinding {
    restoreSelections(selections: readonly ISelection[]): void;
}

/**
 * Движок undo одного документа: стеки с реальными пейлоадами (правки + EOL +
 * снимки выделений). Один на документ, а не на вью: история принадлежит
 * документу (семантика VS Code), и при нескольких редакторах на один документ
 * все правки обязаны сходиться в единственный стек — иначе version-гейт в
 * {@link undo} молча отбрасывал бы шаги, сделанные «чужой» вью. Владелец —
 * `TextFileModel` (пересоздаёт вместе с документом).
 */
export class UndoManager {
    private undoStack: MutableUndoElement[] = [];
    private redoStack: MutableUndoElement[] = [];
    private readonly doc: ITextDocument;

    /**
     * Вызывается после каждого `pushUndoElement` — единая точка-чока для всех правок
     * (набор текста, удаления, вставка). Владелец-модель вешает сюда регистрацию шага
     * в общий `UndoRedoService`. Editor-слой при этом не зависит от Workbench.
     */
    public onDidPush: ((element: IUndoElement) => void) | null = null;

    public constructor(doc: ITextDocument) {
        this.doc = doc;
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

    /**
     * Откатывает верхний шаг. `view` — действующая вью: ей восстанавливается
     * снимок выделений шага; без неё (программный undo без редактора) документ
     * откатывается, а выделения остаются на ремапе самих вью.
     */
    public undo(view: IUndoViewBinding | null = null): boolean {
        const element = this.undoStack.pop();
        if (!element) return false;

        if (this.doc.versionId !== element.versionAfter) {
            return false;
        }

        // applyEdits файрит onDidChangeContent — по нему ВСЕ вью документа
        // (включая действующую) сдвигают свои фолды/выделения/скролл; отдельного
        // прохода по фолдам здесь больше нет.
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

        // The next element on the undo stack now needs its versionAfter updated
        // because the document version changed due to the undo operation
        if (this.undoStack.length > 0) {
            this.undoStack[this.undoStack.length - 1].versionAfter = appliedVersion;
        }

        return true;
    }

    /** Повторяет откаченный шаг; `view` — как в {@link undo}. */
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

        // Update the next redo element's versionAfter to match current doc version
        if (this.redoStack.length > 0) {
            this.redoStack[this.redoStack.length - 1].versionAfter = appliedVersion;
        }

        return true;
    }
}
