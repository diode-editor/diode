import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { Uri } from "../../../base/common/uri.ts";
import type { EditorCursorStyleSetting } from "../../../editor/common/config/editorCursorStyle.ts";
import { currentCursorChangeSource, type CursorChangeSource } from "../../../editor/common/core/cursorChangeSource.ts";
import { EndOfLine } from "../../../editor/common/core/endOfLine.ts";
import { clampPositionToDocument } from "../../../editor/common/core/iPosition.ts";
import { createRange } from "../../../editor/common/core/iRange.ts";
import { createSelection, type ISelection } from "../../../editor/common/core/iSelection.ts";
import { createTextEdit, hasOverlappingEdits, type ITextEdit } from "../../../editor/common/core/iTextEdit.ts";
import { TextEditorPane } from "../../browser/parts/editor/textEditorPane.ts";
import type { IBulkEditService } from "../../contrib/bulkEdit/common/iBulkEditService.ts";
import type { BulkEdit, BulkEditOperation } from "../../contrib/bulkEdit/common/workspaceEdit.ts";
import type { IEditorGroupsService } from "../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../services/editor/common/editorService.ts";
import type {
    IActiveEditorMeta,
    IActiveEditorSelections,
    IEditorOptionsPatch,
    IEditorOptionsService,
    IEditorOptionsState,
} from "../common/iEditorOptionsService.ts";
import {
    type IWireEditorEdit,
    type IWireSelection,
    type IWireWorkspaceEditOp,
    selectionChangeKindOf,
} from "../common/wireTypes.ts";

export class EditorOptionsServiceAdapter implements IEditorOptionsService {
    private readonly group: IEditorService;
    private readonly groups: IEditorGroupsService;
    private readonly workspaceEdits: IBulkEditService;

    /** Falls back to the active group when the tab is already closed. */
    private groupIdOf(editor: TextEditorPane): number {
        return this.groups.groupOf(editor)?.id ?? this.groups.activeGroup.id;
    }
    /** The subprocess sets this selection itself: without the flag it would be echoed back to it. */
    private applyingRemoteSelection = false;
    private selectionFlushScheduled = false;
    /**
     * Captured SYNCHRONOUSLY in the handler (by the deferred flush the gesture scope is already closed);
     * the last one wins: we send the tick's final selections.
     */
    private pendingSelectionSource: CursorChangeSource | undefined;

    public constructor(group: IEditorService, groups: IEditorGroupsService, workspaceEdits: IBulkEditService) {
        this.group = group;
        this.groups = groups;
        this.workspaceEdits = workspaceEdits;
    }

    public getActiveEditorOptions(): IEditorOptionsState | null {
        const editor = this.group.getActiveTabEditor();
        if (editor === null) return null;
        return {
            tabSize: editor.viewState.tabSize,
            insertSpaces: editor.viewState.insertSpaces,
        };
    }

    public setActiveEditorOptions(patch: IEditorOptionsPatch): void {
        const editor = this.group.getActiveTabEditor();
        if (editor === null) return;
        editor.setIndentOptions(patch);
    }

    public setEditorCursorStyle(uri: string, groupId: number, style: EditorCursorStyleSetting): void {
        const editor = this.editorFor(uri, groupId);
        if (editor === null) return;
        editor.cursorStyleOverride = style;
        this.group.editorConfiguration.applyCursorStyle(editor);
    }

    public getActiveEditorFilePath(): string | null {
        const uri = this.group.getActiveTabEditor()?.uri;
        // The consumer (editorconfig) expects a path on disk; an untitled buffer has none.
        return uri?.scheme === "file" ? uri.fsPath : null;
    }

    public getActiveEditorMeta(): IActiveEditorMeta {
        const editor = this.group.getActiveTabEditor();
        return this.metaOfEditor(editor);
    }

    public onActiveEditorChanged(cb: (meta: IActiveEditorMeta) => void): IDisposable {
        return this.group.onActiveEditorChanged((editor) => {
            cb(this.metaOfEditor(editor));
        });
    }

    private metaOfEditor(editor: TextEditorPane | null): IActiveEditorMeta {
        const base = metaOf(editor);
        if (editor === null) return base;
        const owner = this.groups.groupOf(editor) ?? this.groups.activeGroup;
        return { ...base, groupId: owner.id, viewColumn: this.groups.viewColumnOf(owner) };
    }

    public onActiveEditorSelectionChanged(cb: (selections: IActiveEditorSelections) => void): IDisposable {
        return this.group.onDidChangeActiveEditorSelection((editor) => {
            if (this.applyingRemoteSelection) return;
            this.pendingSelectionSource = currentCursorChangeSource();
            if (this.selectionFlushScheduled) return;
            this.selectionFlushScheduled = true;
            queueMicrotask(() => {
                this.selectionFlushScheduled = false;
                const kind = selectionChangeKindOf(this.pendingSelectionSource);
                this.pendingSelectionSource = undefined;
                // The active editor may have changed while we waited for the tick: send the selections
                // of the one active now (its uri is what goes into the payload).
                const current = this.group.getActiveTabEditor() ?? editor;
                cb({
                    uri: current.uri.toString(),
                    selections: wireSelectionsOf(current),
                    groupId: this.groupIdOf(current),
                    ...(kind === undefined ? {} : { kind }),
                });
            });
        });
    }

    public setActiveEditorSelections(uri: string, selections: readonly IWireSelection[], groupId?: number): void {
        const editor = this.editorFor(uri, groupId);
        if (editor === null || selections.length === 0) return;
        const doc = editor.model.document;
        const mapped: ISelection[] = selections.map((sel) => {
            const anchor = clampPositionToDocument(doc, { line: sel.anchorLine, character: sel.anchorCharacter });
            const active = clampPositionToDocument(doc, { line: sel.activeLine, character: sel.activeCharacter });
            return createSelection(anchor.line, anchor.character, active.line, active.character);
        });
        this.applyingRemoteSelection = true;
        try {
            editor.viewState.selections = mapped;
        } finally {
            this.applyingRemoteSelection = false;
        }
        editor.focusEditor();
    }

    public applyActiveEditorEdits(uri: string, edits: readonly IWireEditorEdit[]): boolean {
        // The edit targets the document (the model is shared): any tab of the resource in any group will do.
        const editor = this.anyEditorFor(uri);
        // `EditorViewState` rejects a read-only edit: the extension's `TextEditor.edit()` resolves
        // with this reply, so it must not report false success (same as VS Code).
        if (editor === null || editor.readOnly || edits.length === 0) return false;
        const textEdits = this.toTextEdits(editor, edits);
        // Overlapping edits would apply to already consumed text: reject the whole batch,
        // like `Overlapping ranges are not allowed` in vscode.
        if (textEdits === null) return false;
        editor.applyExternalEdits(textEdits, "extension edit");
        return true;
    }

    public async applyWorkspaceEdit(
        ops: readonly IWireWorkspaceEditOp[],
        options?: { isRefactoring?: boolean },
    ): Promise<boolean> {
        // The subprocess resolves an empty edit as success itself, without RPC; nothing was applied here.
        if (ops.length === 0) return false;
        const edits = toWorkspaceEdit(ops);
        // A file operation on a non-disk resource (`output:`, `jdt:`): reject the whole edit.
        if (edits === null) return false;
        return this.workspaceEdits.applyWorkspaceEdit(edits, "Workspace Edit", {
            respectAutoSaveConfig: options?.isRefactoring === true,
        });
    }

    public saveAll(includeUntitled: boolean): Promise<boolean> {
        return this.group.saveAll({ includeUntitled });
    }

    public async save(uri: string): Promise<string | null> {
        return (await this.group.save(Uri.parse(uri)))?.toString() ?? null;
    }

    /** Positions are clamped to the content; `null` means the batch has overlaps. */
    private toTextEdits(editor: TextEditorPane, edits: readonly IWireEditorEdit[]): ITextEdit[] | null {
        const doc = editor.model.document;
        const textEdits: ITextEdit[] = edits.map((edit) => {
            const start = clampPositionToDocument(doc, edit.range.start);
            const end = clampPositionToDocument(doc, edit.range.end);
            return createTextEdit(createRange(start.line, start.character, end.line, end.character), edit.text);
        });
        return hasOverlappingEdits(textEdits) ? null : textEdits;
    }

    /** With `groupId`, the resource's tab in that group (AS-10); without it, the active tab with this uri. */
    private editorFor(uri: string, groupId?: number): TextEditorPane | null {
        if (groupId !== undefined) {
            const target = this.groups.groups.find((candidate) => candidate.id === groupId);
            if (target === undefined) return null;
            const index = target.findPaneIndex(Uri.parse(uri));
            const pane = index >= 0 ? target.getPane(index) : null;
            return pane instanceof TextEditorPane ? pane : null;
        }
        const editor = this.group.getActiveTabEditor();
        if (editor?.uri.toString() !== uri) return null;
        return editor;
    }

    /** All tabs of a resource share one model. */
    private anyEditorFor(uri: string): TextEditorPane | null {
        const active = this.group.getActiveTabEditor();
        if (active !== null && active.uri.toString() === uri) return active;
        return this.group.getEditors().find((editor) => editor.uri.toString() === uri) ?? null;
    }
}

/**
 * Coordinates are passed as is; the executor clamps them. `null` means a file operation on a non-disk
 * resource: the whole edit is rejected.
 */
function toWorkspaceEdit(ops: readonly IWireWorkspaceEditOp[]): BulkEdit | null {
    const result: BulkEditOperation[] = [];
    for (const op of ops) {
        if (op.kind === "text") {
            result.push({ resource: op.resource, edits: op.edits });
            continue;
        }
        if (op.kind === "rename") {
            const from = filePathOf(op.from);
            const to = filePathOf(op.to);
            if (from === null || to === null) return null;
            result.push({
                kind: "rename",
                from,
                to,
                ...(op.overwrite === true ? { overwrite: true } : {}),
                ...(op.ignoreIfExists === true ? { ignoreIfExists: true } : {}),
            });
            continue;
        }
        const filePath = filePathOf(op.resource);
        if (filePath === null) return null;
        if (op.kind === "create") {
            result.push({
                kind: "create",
                to: filePath,
                ...(op.contents === undefined ? {} : { contents: op.contents }),
                ...(op.overwrite === true ? { overwrite: true } : {}),
                ...(op.ignoreIfExists === true ? { ignoreIfExists: true } : {}),
            });
            continue;
        }
        result.push({
            kind: "delete",
            from: filePath,
            ...(op.ignoreIfNotExists === true ? { ignoreIfNotExists: true } : {}),
        });
    }
    return result;
}

function filePathOf(resource: string): string | null {
    const uri = Uri.parse(resource);
    return uri.scheme === "file" ? uri.fsPath : null;
}

/** The first one is the primary. */
function wireSelectionsOf(editor: TextEditorPane): IWireSelection[] {
    return editor.viewState.selections.map((sel) => ({
        anchorLine: sel.anchor.line,
        anchorCharacter: sel.anchor.character,
        activeLine: sel.active.line,
        activeCharacter: sel.active.character,
    }));
}

function metaOf(editor: TextEditorPane | null): IActiveEditorMeta {
    if (editor === null) {
        return { uri: null, languageId: null, isDirty: false, encoding: null, eol: null, selection: null };
    }
    const selection: IWireSelection | null = wireSelectionsOf(editor)[0] ?? null;
    return {
        uri: editor.uri.toString(),
        languageId: editor.languageId,
        isDirty: editor.isModified,
        encoding: editor.encoding,
        eol: editor.eol === EndOfLine.CRLF ? 2 : 1,
        selection,
    };
}
