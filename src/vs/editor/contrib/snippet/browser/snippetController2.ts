import { DisposableStore } from "../../../../base/common/lifecycle.ts";
import { createCursorSelection } from "../../../common/core/iSelection.ts";
import { hasOverlappingEdits, type ITextEdit } from "../../../common/core/iTextEdit.ts";
import type { ITextDocument } from "../../../common/model/iTextDocument.ts";
import type { EditorViewState } from "../../../common/viewModel/editorViewState.ts";
import type { ICursorStateComputer } from "../../../common/viewModel/trackedSelections.ts";

import {
    createSnippetInsert,
    type ISnippetDocument,
    type ISnippetEdit,
    type ISnippetSessionDocument,
    SnippetSession,
} from "./snippetSession.ts";

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
    /** Upstream `_modelVersionId`: an undo back to it takes the snippet away. */
    private versionBeforeInsert = -1;

    private constructor(private readonly editor: ISnippetEditor) {}

    public get isInSnippet(): boolean {
        return this.session !== null;
    }

    /** A live session always has one: it ends on reaching its last group. */
    public get hasNextTabstop(): boolean {
        return this.session !== null;
    }

    public get hasPrevTabstop(): boolean {
        return this.session !== null && !this.session.isAtFirstPlaceholder;
    }

    /**
     * Upstream `SnippetController2.apply` → `SnippetSession.insert`: the edits and the first caret as one step, the
     * caret revealed, then the session. `false`, with nothing changed, for overlapping ranges.
     */
    public apply(snippetEdits: readonly ISnippetEdit[], options: ISnippetApplyOptions): boolean {
        const { editor } = this;
        const { viewState } = editor;
        const document = editor.model.document;
        const { edits, snippet, start } = createSnippetInsert(document, snippetEdits, {
            adjustWhitespace: options.keepWhitespace !== true,
            tabSize: viewState.tabSize,
            insertSpaces: viewState.insertSpaces,
        });
        if (hasOverlappingEdits(edits)) return false;
        this.cancel();
        editor.focusEditor();
        this.versionBeforeInsert = document.alternativeVersionId;
        editor.applyExternalEdits(
            edits,
            "snippet",
            (inverseEdits) => {
                if (snippet.placeholders.length === 0) {
                    return inverseEdits.map(({ range: { end } }) => createCursorSelection(end.line, end.character));
                }
                this.session = new SnippetSession(document, snippet, start);
                return this.session.move(true);
            },
            options,
        );
        const [primary] = viewState.selections;
        viewState.revealRangeByType({ start: primary.active, end: primary.active }, "default");
        this.updateState();
        if (this.session === null) return true;
        this.sessionStore.add(
            document.onDidChangeModelContent((event) => {
                if (event.isFlush) this.cancel();
                else this.publishTabstops();
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
        this.publishTabstops();
    }

    /** `jumpToNextSnippetPlaceholder`. */
    public next(): void {
        this.move(true);
    }

    /** `jumpToPrevSnippetPlaceholder`. */
    public prev(): void {
        this.move(false);
    }

    private move(fwd: boolean): void {
        if (this.session === null) return;
        const selections = this.session.move(fwd);
        const { viewState } = this.editor;
        viewState.selections = selections;
        const { active } = selections[0];
        viewState.revealRangeByType({ start: active, end: active }, "centerIfOutsideViewport");
        this.updateState();
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
    }

    private publishTabstops(): void {
        this.editor.viewState.snippetTabstopRanges = this.session?.tabstopRanges() ?? [];
    }
}
