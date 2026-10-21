import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import type { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";

/** Upstream `DEFAULT_EDITOR_ASSOCIATION.id`: the text editor, also both sides of a text diff. */
export const DEFAULT_EDITOR_ID = "default";

/**
 * What a group needs from any pane (in vscode that is `EditorInput` + `EditorPane`; here the pane
 * is both its own model and view). Everything text-specific lives on {@link TextEditorPane}.
 */
export interface IEditorPane extends IDisposable {
    /** Also the tab identity: reopening the resource switches to this tab. */
    readonly uri: Uri;

    /** Separate from {@link uri}: a diff has a label like `a.ts ↔ HEAD` that is not in the path. */
    readonly label: string;

    readonly view: TUIElement;

    readonly isModified: boolean;

    /** Upstream `EditorInput.editorId`: the key in `workbench.editor.autoLockGroups`. */
    readonly editorId?: string;

    readonly readOnly: boolean;

    /** The file is deleted on disk but the model lives on (upstream "orphaned"): the tab is struck through. */
    readonly isOrphaned?: boolean;

    /** Cursor commands work through it; a pane of another kind (an image) may not have one. */
    readonly viewState?: EditorViewState;

    /**
     * One per selection, in document order: with multiple cursors Cut must copy exactly what it
     * deletes. Separate from `viewState.getSelectedTexts()` because a pane may decide differently
     * (the diff drops placeholders of collapsed regions).
     */
    getSelectedTexts(): string[];

    /** Modified marker and label only: the group has no need to know about EOL or the on-disk file state. */
    onDidChangeState(cb: () => void): IDisposable;

    focusEditor(): void;
}
