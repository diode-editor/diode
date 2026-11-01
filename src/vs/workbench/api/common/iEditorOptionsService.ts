export interface IEditorOptionsState {
    readonly tabSize: number;
    readonly insertSpaces: boolean;
}

export interface IEditorOptionsPatch {
    readonly tabSize?: number;
    readonly insertSpaces?: boolean;
}

/**
 * Separate from {@link IActiveEditorMeta}: a selection change is not an active editor
 * change, so `onDidChangeActiveTextEditor` listeners must not fire.
 */
export interface IActiveEditorSelections {
    readonly uri: string;
    /** The first one is primary. */
    readonly selections: readonly IWireSelection[];
    /** Stable group id: the subprocess keys its per-editor cache by it. */
    readonly groupId?: number;
    /** Absent if the gesture is untagged: undo/redo, find navigation (`cursorChangeSource.ts`). */
    readonly kind?: WireSelectionChangeKind;
}

export interface IActiveEditorMeta {
    /** `null`: no active editor. */
    readonly uri: string | null;
    readonly languageId: string | null;
    readonly isDirty: boolean;
    /** id from SUPPORTED_ENCODINGS. */
    readonly encoding: string | null;
    /** `vscode.EndOfLine`: 1=LF, 2=CRLF. */
    readonly eol: 1 | 2 | null;
    readonly selection: IWireSelection | null;
    readonly groupId?: number;
    /** 1..N, derived. */
    readonly viewColumn?: number;
}

import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { EditorCursorStyleSetting } from "../../../editor/common/config/editorCursorStyle.ts";
import type { IRange } from "../../../editor/common/core/iRange.ts";
import type { RangeRevealType } from "../../../editor/common/viewModel/editorViewState.ts";

import type { IWireEditorEdit, IWireSelection, IWireWorkspaceEditOp, WireSelectionChangeKind } from "./wireTypes.ts";

export interface IEditorOptionsService {
    getActiveEditorOptions(): IEditorOptionsState | null;
    setActiveEditorOptions(patch: IEditorOptionsPatch): void;
    /**
     * The extension's session override of `editor.cursorStyle` for the tab of `uri` in group `groupId`;
     * no-op if that tab is gone.
     */
    setEditorCursorStyle(uri: string, groupId: number, style: EditorCursorStyleSetting): void;
    /**
     * Scrolls the tab of `uri` in group `groupId`, whichever group is active; the range is clamped to the
     * document, selection and focus stay. No-op if that tab is gone.
     */
    revealEditorRange(uri: string, groupId: number, range: IRange, revealType: RangeRevealType): void;
    getActiveEditorFilePath(): string | null;
    getActiveEditorMeta(): IActiveEditorMeta;
    onActiveEditorChanged(cb: (meta: IActiveEditorMeta) => void): IDisposable;
    /** Events coalesce within a tick: a multi-step operation yields one notification. */
    onActiveEditorSelectionChanged(cb: (selections: IActiveEditorSelections) => void): IDisposable;
    /** No-op if the active uri differs from `uri`: the editor changed while the RPC was in flight. */
    setActiveEditorSelections(uri: string, selections: readonly IWireSelection[], groupId?: number): void;
    /** As one undoable batch; `false` if there is no active editor, the uri differs or nothing to apply. */
    applyActiveEditorEdits(
        uri: string,
        edits: readonly IWireEditorEdit[],
        options?: {
            version?: number;
            setEndOfLine?: 1 | 2;
            undoStopBefore?: boolean;
            undoStopAfter?: boolean;
            selectionsAfter?: readonly IWireSelection[];
        },
    ): boolean;
    /**
     * As one undo step. All-or-nothing: if any resource fails validation, nothing is
     * applied and the result is `false`. An empty list is also `false`: the subprocess
     * answers success for an empty edit itself. `isRefactoring`: affected dirty buffers
     * are saved per `files.refactoring.autoSave`.
     */
    applyWorkspaceEdit(ops: readonly IWireWorkspaceEditOp[], options?: { isRefactoring?: boolean }): Promise<boolean>;

    saveAll(includeUntitled: boolean): Promise<boolean>;

    /** `null`: not open or not saved. */
    save(uri: string): Promise<string | null>;
}
