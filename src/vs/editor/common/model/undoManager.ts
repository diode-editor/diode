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
    /** Elements with one token are one step: `undo`/`redo` move them together. */
    token: UndoStepToken;
}

/** The document's other views remap their state themselves on `onDidChangeContent`. */
export interface IUndoViewBinding {
    restoreSelections(selections: readonly ISelection[]): void;
}

/**
 * Identity of a step on the stack. Comparing by document version does not work: `undo`
 * rewrites the next element's `versionAfter`, so a version captured outside goes stale.
 */
export type UndoStepToken = object;

/**
 * One per document, not per view: otherwise the version gate in {@link undo} would
 * silently drop steps made by "another" view.
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
        this.undoStack.push({ ...element, token: {} });
        this.redoStack.length = 0;
        this.onDidPush?.(element);
    }

    /**
     * Upstream's edit without an undo stop between: it joins the top step, so no new step is announced.
     * Nothing on the stack — an ordinary push.
     */
    public joinUndoElement(element: IUndoElement): void {
        const top = this.undoStack.at(-1);
        if (top === undefined) {
            this.pushUndoElement(element);
            return;
        }
        this.undoStack.push({ ...element, token: top.token });
        this.redoStack.length = 0;
    }

    public peekUndoStep(): UndoStepToken | undefined {
        return this.undoStack.at(-1)?.token;
    }

    public peekRedoStep(): UndoStepToken | undefined {
        return this.redoStack.at(-1)?.token;
    }

    /** `undefined` is a valid argument and always gives `false`. */
    public canUndoStep(token: UndoStepToken | undefined): boolean {
        const top = this.undoStack.at(-1);
        return top !== undefined && top.token === token && this.doc.versionId === top.versionAfter;
    }

    public canRedoStep(token: UndoStepToken | undefined): boolean {
        const top = this.redoStack.at(-1);
        return top !== undefined && top.token === token && this.doc.versionId === top.versionAfter;
    }

    /** `view` gets the step's selection snapshot restored; other views remap themselves. */
    public undo(view: IUndoViewBinding | null = null): boolean {
        return this.moveStep(this.undoStack, this.redoStack, view, "undo");
    }

    public redo(view: IUndoViewBinding | null = null): boolean {
        return this.moveStep(this.redoStack, this.undoStack, view, "redo");
    }

    /** All elements of the top step of `from`, newest first; the last one restores its selections last. */
    private moveStep(
        from: MutableUndoElement[],
        to: MutableUndoElement[],
        view: IUndoViewBinding | null,
        origin: "undo" | "redo",
    ): boolean {
        const token = from.at(-1)?.token;
        if (token === undefined) return false;
        const moved: UndoStepToken = {};
        while (from.at(-1)?.token === token) {
            if (!this.moveElement(from, to, moved, view, origin)) return false;
        }
        return true;
    }

    private moveElement(
        from: MutableUndoElement[],
        to: MutableUndoElement[],
        token: UndoStepToken,
        view: IUndoViewBinding | null,
        origin: "undo" | "redo",
    ): boolean {
        const element = from.pop();
        // Stryker disable next-line OptionalChaining: the caller has just seen this element at the top of `from`
        if (this.doc.versionId !== element?.versionAfter) return false;

        const { inverseEdits } = this.doc.applyUndoRedoEdits(element.backwardEdits, origin);
        view?.restoreSelections(element.beforeSelections);
        if (element.eolBefore !== undefined) {
            this.doc.setEol(element.eolBefore);
        }
        // After the EOL: restoring it is a version too.
        const appliedVersion = this.doc.versionId;

        to.push({
            label: element.label,
            versionBefore: element.versionAfter,
            versionAfter: appliedVersion,
            forwardEdits: element.backwardEdits,
            backwardEdits: inverseEdits,
            beforeSelections: element.afterSelections,
            afterSelections: element.beforeSelections,
            eolBefore: element.eolAfter,
            eolAfter: element.eolBefore,
            token,
        });

        // Rewriting `versionAfter` is why {@link UndoStepToken} compares identity, not versions.
        if (from.length > 0) {
            from[from.length - 1].versionAfter = appliedVersion;
        }

        return true;
    }
}
