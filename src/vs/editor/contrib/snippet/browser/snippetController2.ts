import { Emitter } from "../../../../base/common/event.ts";
import { DisposableStore } from "../../../../base/common/lifecycle.ts";
import { rangeContainsRange } from "../../../common/core/iRange.ts";
import { createCursorSelection, selectionToRange } from "../../../common/core/iSelection.ts";
import { hasOverlappingEdits, type ITextEdit } from "../../../common/core/iTextEdit.ts";
import type { ITextDocument } from "../../../common/model/iTextDocument.ts";
import type { EditorViewState } from "../../../common/viewModel/editorViewState.ts";
import type { ICursorStateComputer } from "../../../common/viewModel/trackedSelections.ts";

import {
    createSnippetInsert,
    type ISnippetActiveChoice,
    type ISnippetEdit,
    type ISnippetSessionDocument,
    SnippetSession,
} from "./snippetSession.ts";
import { type ISnippetDocument, type ISnippetVariableSources, leadingWhitespaceBefore } from "./snippetVariables.ts";

/** What the controller needs of a text editor pane. */
export interface ISnippetEditor {
    readonly model: {
        readonly document: ISnippetDocument &
            ISnippetSessionDocument &
            Pick<ITextDocument, "alternativeVersionId" | "onDidChangeModelContent">;
    };
    readonly viewState: Pick<
        EditorViewState,
        | "tabSize"
        | "insertSpaces"
        | "selections"
        | "revealRangeByType"
        | "onDidChangeCursorPosition"
        | "snippetTabstopRanges"
    >;
    focusEditor(): void;
    applyExternalEdits(
        edits: readonly ITextEdit[],
        label: string,
        computeCursorState: ICursorStateComputer,
        undoStops: { readonly undoStopBefore?: boolean; readonly undoStopAfter?: boolean },
    ): void;
}

export interface ISnippetApplyOptions {
    readonly keepWhitespace?: boolean;
    readonly variables?: ISnippetVariableSources;
    readonly undoStopBefore?: boolean;
    readonly undoStopAfter?: boolean;
}

/** One per view: the view state is what a tab keeps of its editor. */
const controllers = new WeakMap<object, SnippetController2>();

/**
 * Port of upstream `SnippetController2` for one editor: inserts a snippet and keeps its session while the selections
 * stay in its placeholders. The `inSnippetMode`, `hasNextTabstop`, `hasPrevTabstop` keys and the commands are the
 * workbench's (`workbench/contrib/snippet`). Deviation: a snippet inserted during a session ends it and starts its
 * own, upstream merges a nested one (#1035).
 */
export class SnippetController2 {
    public static get(editor: ISnippetEditor): SnippetController2 {
        let controller = controllers.get(editor.viewState);
        if (controller === undefined) {
            controller = new SnippetController2(editor);
            controllers.set(editor.viewState, controller);
        }
        return controller;
    }

    private session: SnippetSession | null = null;
    /** What the session listens to. */
    private readonly sessionStore = new DisposableStore();
    /** Upstream `_modelVersionId`: an undo back to it takes the snippet away. Read only while there is a session. */
    private versionBeforeInsert = 0;
    private readonly onDidUpdateStateEmitter = new Emitter<void>();

    /**
     * After the insert, every selection change in a session and the session's end: where upstream `_updateState`
     * and `cancel` set the context keys.
     */
    public readonly onDidUpdateState = this.onDidUpdateStateEmitter.event;

    private constructor(private readonly editor: ISnippetEditor) {}

    public get isInSnippet(): boolean {
        return this.session !== null;
    }

    public get hasPrevTabstop(): boolean {
        return this.session !== null && !this.session.isAtFirstPlaceholder;
    }

    /**
     * Upstream `SnippetSession.activeChoice`: the session is on a choice. Deviation: only with the primary selection
     * in it; upstream keeps a choice a click has left for another tab stop of the session.
     */
    public get activeChoice(): ISnippetActiveChoice | undefined {
        const active = this.session?.activeChoice;
        if (active === undefined) return undefined;
        return rangeContainsRange(active.range, selectionToRange(this.editor.viewState.selections[0]))
            ? active
            : undefined;
    }

    /**
     * Upstream `SnippetController2.apply` → `SnippetSession.insert`: the edits and the first caret as one step, the
     * caret revealed, then the session. `false`, with nothing changed, for overlapping ranges.
     */
    public apply(snippetEdits: readonly ISnippetEdit[], options: ISnippetApplyOptions): boolean {
        const { editor } = this;
        const { viewState } = editor;
        const document = editor.model.document;
        const { edits, snippet } = createSnippetInsert(document, snippetEdits, {
            adjustWhitespace: options.keepWhitespace !== true,
            tabSize: viewState.tabSize,
            insertSpaces: viewState.insertSpaces,
            variables: options.variables,
        });
        if (hasOverlappingEdits(edits)) return false;
        this.cancel();
        editor.focusEditor();
        const { start } = edits[0].range;
        const indentation = {
            lineLeadingWhitespace: leadingWhitespaceBefore(document, start),
            tabSize: viewState.tabSize,
            insertSpaces: viewState.insertSpaces,
        };
        this.versionBeforeInsert = document.alternativeVersionId;
        editor.applyExternalEdits(
            edits,
            "snippet",
            (inverseEdits) => {
                if (snippet.placeholders.length === 0) {
                    return inverseEdits.map(({ range: { end } }) => createCursorSelection(end.line, end.character));
                }
                this.session = new SnippetSession(document, snippet, start, indentation);
                return this.session.move(true);
            },
            options,
        );
        const [primary] = viewState.selections;
        viewState.revealRangeByType({ start: primary.active, end: primary.active }, "default");
        this.updateState();
        const { session } = this;
        if (session === null) return true;
        this.sessionStore.add(
            document.onDidChangeModelContent((event) => {
                if (event.isFlush) this.cancel();
                else this.publishTabstops(session);
            }),
        );
        this.sessionStore.add(
            viewState.onDidChangeCursorPosition(() => {
                this.updateState();
            }),
        );
        return true;
    }

    /** Upstream `_updateState`: after the insert and every selection change. */
    private updateState(): void {
        const { session } = this;
        if (session === null) return;
        if (this.versionBeforeInsert === this.editor.model.document.alternativeVersionId) {
            // Undone back to before the insert.
            this.cancel();
            return;
        }
        if (session.isAtLastPlaceholder || !session.isSelectionWithinPlaceholders(this.editor.viewState.selections)) {
            this.cancel();
            return;
        }
        this.publishTabstops(session);
        this.onDidUpdateStateEmitter.fire();
    }

    /** `jumpToNextSnippetPlaceholder`. */
    public next(): void {
        this.move(true);
    }

    /** `jumpToPrevSnippetPlaceholder`. */
    public prev(): void {
        this.move(false);
    }

    /**
     * Upstream `OneSnippet.move`: the transforms of the group left behind are their own undo step, and the selections
     * of the next group come with it, so the state is updated once, on the new group.
     */
    private move(fwd: boolean): void {
        const { session, editor } = this;
        if (session === null) return;
        const { viewState } = editor;
        const edits = session.placeholderTransformEdits();
        if (edits.length === 0) {
            viewState.selections = session.move(fwd);
        } else {
            // Stryker disable next-line StringLiteral: the label of an undo step is shown nowhere
            editor.applyExternalEdits(edits, "snippet.placeholderTransform", () => session.move(fwd), {});
        }
        // The selection change has updated the state: on the last group the session is over.
        const { active } = viewState.selections[0];
        viewState.revealRangeByType({ start: active, end: active }, "centerIfOutsideViewport");
    }

    /** `acceptSnippet`: on to the end. */
    public finish(): void {
        while (this.session !== null) this.next();
    }

    /** `leaveSnippet` resets to the primary selection; the selections stay as they are otherwise. */
    public cancel(resetSelection = false): void {
        this.sessionStore.clear();
        const { session } = this;
        if (session === null) return;
        this.session = null;
        session.dispose();
        const { viewState } = this.editor;
        viewState.snippetTabstopRanges = [];
        if (resetSelection) viewState.selections = [viewState.selections[0]];
        this.onDidUpdateStateEmitter.fire();
    }

    private publishTabstops(session: SnippetSession): void {
        this.editor.viewState.snippetTabstopRanges = session.tabstopRanges();
    }
}
