import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { isTextEditorPane, type TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { BaseTextEditorModel } from "../../../common/editor/textEditorModel.ts";
import type { DialogService } from "../../dialogs/browser/dialogService.ts";

import type { EditorGroup } from "./editorGroupModel.ts";

/** All editing surfaces of all groups: text tabs and diff sides. */
export interface IEditorCloseSurfaces {
    surfaces(): readonly TextEditorPane[];
}

/**
 * Counterpart of upstream `EditorGroupView.handleCloseConfirmation`. Save closes the tab only if
 * all its surfaces were saved (untitled without a path keeps the tab — no text is lost);
 * Cancel is a veto that aborts the series.
 */
export class EditorCloseHandler {
    /** A repeated request for the same tab joins the open dialog (upstream `mapEditorToPendingConfirmation`). */
    private readonly pending = new Map<IEditorPane, Promise<boolean>>();

    public constructor(
        private readonly dialogs: DialogService,
        private readonly surfaces: IEditorCloseSurfaces,
    ) {}

    /**
     * Targets are held as panes, not indices: tabs shift between dialogs, so the position is looked up again.
     * Clean tabs close synchronously, before the first dialog.
     *
     * The active tab waits until the next dialog or the end (upstream `doCloseEditors` closes it last):
     * closing it first would activate each next tab on the way out, reshuffling the MRU and the
     * recent-files history. A dialog activates the tab it asks about anyway.
     */
    public async confirmAndClose(group: EditorGroup, panes: readonly IEditorPane[]): Promise<boolean> {
        let deferred: IEditorPane | null = null;
        const close = (pane: IEditorPane): void => {
            // The target may already be closed (during the dialog or by a concurrent request): the group skips position -1.
            group.closeTab(group.getPanes().indexOf(pane));
        };
        for (const pane of panes) {
            if (this.needsCloseConfirm(pane)) {
                // Stryker disable next-line ConditionalExpression: equivalent — closing `null` looks up position -1, which the group skips
                if (deferred !== null) close(deferred);
                deferred = null;
                if (!(await this.confirm(group, pane))) return false;
            }
            if (pane === group.activePane) deferred = pane;
            else close(pane);
        }
        if (deferred !== null) close(deferred);
        return true;
    }

    private confirm(group: EditorGroup, pane: IEditorPane): Promise<boolean> {
        const pending = this.pending.get(pane);
        if (pending !== undefined) return pending;
        const result = this.doConfirm(group, pane).finally(() => {
            this.pending.delete(pane);
        });
        this.pending.set(pane, result);
        return result;
    }

    private async doConfirm(group: EditorGroup, pane: IEditorPane): Promise<boolean> {
        // The tab becomes visible before the question (upstream `doOpenEditor`).
        group.activateTab(group.getPanes().indexOf(pane));
        const targets = this.saveTargetsOf(pane);
        const choice = await this.dialogs.confirmSave(targets.map((target) => target.label).join(", "));
        if (choice === "cancel") return false;
        if (choice === "save") {
            // An explicit Save overwrites the file even with external changes — the user's choice must not
            // get lost. Not saved (untitled without a path, write error) — veto.
            for (const target of targets) {
                if ((await target.save({ overwrite: true })) !== "saved") return false;
            }
        }
        return true;
    }

    /**
     * Text tab: modified and the last one showing the document. Diff: has a dirty side that is no longer
     * visible anywhere. Other panes: by `isModified`.
     */
    public needsCloseConfirm(pane: IEditorPane): boolean {
        if (pane instanceof DiffEditorPane2) return this.dirtyExclusiveDiffSides(pane).length > 0;
        // Without this branch a foreign pane (Keyboard Shortcuts) would fall into the text formula with `model === undefined`
        // and give the same `isModified`, so the mutant is equivalent. The branch keeps the meaning, not the result.
        // Stryker disable next-line ConditionalExpression: equivalent — see above
        if (!isTextEditorPane(pane)) return pane.isModified;
        return pane.isModified && this.isLastPaneForDocument(pane);
    }

    public dirtyExclusiveDiffSides(pane: DiffEditorPane2): TextEditorPane[] {
        return pane.sidePanes().filter((side) => side.isModified && this.holdersOf(side.model) <= 1);
    }

    /** While the document is visible elsewhere, the tab closes silently: edits live in the shared model (as in VS Code). */
    public isLastPaneForDocument(editor: TextEditorPane): boolean {
        return this.holdersOf(editor.model) <= 1;
    }

    private saveTargetsOf(pane: IEditorPane): TextEditorPane[] {
        if (pane instanceof DiffEditorPane2) return this.dirtyExclusiveDiffSides(pane);
        /* v8 ignore start -- needsCloseConfirm for a non-diff is true only for a text pane: panes of other kinds (Keyboard Shortcuts, extension page) are never modified */
        // Stryker disable next-line ConditionalExpression,ArrayDeclaration: unreachable branch — see v8 ignore above
        if (!isTextEditorPane(pane)) return [];
        /* v8 ignore stop */
        return [pane];
    }

    private holdersOf(model: BaseTextEditorModel): number {
        return this.surfaces.surfaces().filter((pane) => pane.model === model).length;
    }
}
