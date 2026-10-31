import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { DisposableStore } from "../../../base/common/lifecycle.ts";
import { Uri } from "../../../base/common/uri.ts";
import type { EditorCursorStyleSetting } from "../../../editor/common/config/editorCursorStyle.ts";
import {
    currentCursorChangeSource,
    type CursorChangeSource,
    withCursorChangeSource,
} from "../../../editor/common/core/cursorChangeSource.ts";
import { EndOfLine } from "../../../editor/common/core/endOfLine.ts";
import { clampPositionToDocument } from "../../../editor/common/core/iPosition.ts";
import { createRange, type IRange } from "../../../editor/common/core/iRange.ts";
import { createSelection, type ISelection } from "../../../editor/common/core/iSelection.ts";
import { createTextEdit, hasOverlappingEdits, type ITextEdit } from "../../../editor/common/core/iTextEdit.ts";
import type { RangeRevealType } from "../../../editor/common/viewModel/editorViewState.ts";
import { DiffEditorPane2 } from "../../browser/parts/editor/diffEditorPane2.ts";
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

    public revealEditorRange(uri: string, groupId: number, range: IRange, revealType: RangeRevealType): void {
        const editor = this.editorFor(uri, groupId);
        if (editor === null) return;
        const doc = editor.model.document;
        const start = clampPositionToDocument(doc, range.start);
        const end = clampPositionToDocument(doc, range.end);
        editor.viewState.revealRangeByType({ start, end }, revealType);
    }

    public getActiveEditorFilePath(): string | null {
        const uri = this.group.getActiveTabEditor()?.uri;
        // The consumer (editorconfig) expects a path on disk; an untitled buffer has none.
        return uri?.scheme === "file" ? uri.fsPath : null;
    }

    public getActiveEditorMeta(): IActiveEditorMeta {
        return this.metaOfEditor(this.modifiedSideOfActiveDiff() ?? this.group.getActiveTabEditor());
    }

    /** Upstream `mainThreadDocumentsAndEditors`: for an active diff the API's active editor is its modified side. */
    private modifiedSideOfActiveDiff(): TextEditorPane | null {
        const pane = this.groups.activeGroup.activePane;
        if (!(pane instanceof DiffEditorPane2) || pane.snapshotSides().includes("modified")) return null;
        return pane.sidePanes()[1];
    }

    public onActiveEditorChanged(cb: (meta: IActiveEditorMeta) => void): IDisposable {
        return this.group.onActiveEditorChanged((editor) => {
            cb(this.metaOfEditor(editor ?? this.modifiedSideOfActiveDiff()));
        });
    }

    private metaOfEditor(editor: TextEditorPane | null): IActiveEditorMeta {
        const base = metaOf(editor);
        if (editor === null) return base;
        const owner = this.groups.groupOf(editor) ?? this.groups.activeGroup;
        return { ...base, groupId: owner.id, viewColumn: this.groups.viewColumnOf(owner) };
    }

    public onActiveEditorSelectionChanged(cb: (selections: IActiveEditorSelections) => void): IDisposable {
        const store = new DisposableStore();
        store.add(this.forwardInactiveSelections(cb));
        store.add(this.forwardActiveSelections(cb));
        return store;
    }

    /** Each editor reports its own selection: upstream listens to every visible editor, not only the active one. */
    private forwardInactiveSelections(cb: (selections: IActiveEditorSelections) => void): IDisposable {
        const pending = new Map<TextEditorPane, CursorChangeSource | undefined>();
        return this.group.onDidChangeInactiveEditorSelection((editor) => {
            // Stryker disable next-line ConditionalExpression: equivalent, an extra flush finds nothing pending
            if (pending.size === 0) {
                queueMicrotask(() => {
                    const flushed = [...pending];
                    pending.clear();
                    for (const [pane, source] of flushed) {
                        const kind = selectionChangeKindOf(source);
                        cb({
                            uri: pane.uri.toString(),
                            selections: wireSelectionsOf(pane),
                            groupId: this.groupIdOf(pane),
                            ...(kind === undefined ? {} : { kind }),
                        });
                    }
                });
            }
            pending.set(editor, currentCursorChangeSource());
        });
    }

    private forwardActiveSelections(cb: (selections: IActiveEditorSelections) => void): IDisposable {
        return this.group.onDidChangeActiveEditorSelection((editor) => {
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
        // As upstream: the extension hears about its own change with kind Command, and nothing when
        // the selection stays the same (`mainThreadEditor` sends only a delta).
        if (!sameSelections(editor.viewState.selections, mapped)) {
            withCursorChangeSource("command", () => {
                editor.viewState.selections = mapped;
            });
        }
        editor.focusEditor();
    }

    public applyActiveEditorEdits(
        uri: string,
        edits: readonly IWireEditorEdit[],
        options: { version?: number; setEndOfLine?: EndOfLine; undoStopBefore?: boolean; undoStopAfter?: boolean } = {},
    ): boolean {
        // The edit targets the document (the model is shared): any tab of the resource in any group will do.
        const editor = this.anyEditorFor(uri);
        // `EditorViewState` rejects a read-only edit: the extension's `TextEditor.edit()` resolves
        // with this reply, so it must not report false success (same as VS Code).
        if (editor === null || editor.readOnly) return false;
        if (edits.length === 0 && options.setEndOfLine === undefined) return false;
        // Upstream `$tryApplyEdits`: the edit was built against a text that is no longer there.
        if (options.version !== undefined && options.version !== editor.model.document.versionId) return false;
        const textEdits = this.toTextEdits(editor, edits);
        // Overlapping edits would apply to already consumed text: reject the whole batch,
        // like `Overlapping ranges are not allowed` in vscode.
        if (textEdits === null) return false;
        if (textEdits.length > 0) editor.applyExternalEdits(textEdits, "extension edit", undefined, options);
        if (options.setEndOfLine !== undefined) editor.setEol(options.setEndOfLine);
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
        // Everything was a legitimate skip (a create or a missing delete on an untitled uri).
        if (edits.length === 0) return true;
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
            result.push({
                resource: op.resource,
                edits: op.edits,
                ...(op.setEndOfLine === undefined ? {} : { setEndOfLine: op.setEndOfLine }),
            });
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
                ...(op.overwrite === undefined ? {} : { overwrite: op.overwrite }),
                ...(op.ignoreIfExists === true ? { ignoreIfExists: true } : {}),
            });
            continue;
        }
        // Upstream `CreateFileEdit`: "ignore, will be handled by a later edit"; a text edit brings the buffer to life.
        // Upstream `DeleteOperation`: nothing on disk answers for it, so it is a missing resource.
        if (Uri.parse(op.resource).scheme === "untitled" && (op.kind === "create" || op.ignoreIfNotExists === true)) {
            continue;
        }
        const filePath = filePathOf(op.resource);
        if (filePath === null) return null;
        if (op.kind === "create") {
            result.push({
                kind: "create",
                to: filePath,
                ...(op.contents === undefined ? {} : { contents: op.contents }),
                ...(op.contentsBase64 === undefined ? {} : { contents: Buffer.from(op.contentsBase64, "base64") }),
                ...(op.overwrite === undefined ? {} : { overwrite: op.overwrite }),
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
        isDirty: editor.isDirtyForExtensions,
        encoding: editor.encoding,
        eol: editor.eol === EndOfLine.CRLF ? 2 : 1,
        selection,
    };
}

function sameSelections(current: readonly ISelection[], next: readonly ISelection[]): boolean {
    return (
        current.length === next.length &&
        current.every((selection, index) => {
            const other = next[index];
            return (
                selection.anchor.line === other.anchor.line &&
                selection.anchor.character === other.anchor.character &&
                selection.active.line === other.active.line &&
                selection.active.character === other.active.character
            );
        })
    );
}
