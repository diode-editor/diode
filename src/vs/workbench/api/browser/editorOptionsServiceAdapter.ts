import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { Uri } from "../../../base/common/uri.ts";
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

    /** Вкладка уже закрыта — активная группа. */
    private groupIdOf(editor: TextEditorPane): number {
        return this.groups.groupOf(editor)?.id ?? this.groups.activeGroup.id;
    }
    /** Выделение ставит сам субпроцесс: без флага присланное уехало бы ему обратно эхом. */
    private applyingRemoteSelection = false;
    private selectionFlushScheduled = false;
    /**
     * Снимается СИНХРОННО в обработчике (в отложенном флаше область жеста уже закрыта);
     * побеждает последний — отправляем итоговые выделения тика.
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

    public getActiveEditorFilePath(): string | null {
        const uri = this.group.getActiveTabEditor()?.uri;
        // Потребитель (editorconfig) ждёт путь на диске; у безымянного буфера его нет.
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
                // Активный редактор мог смениться, пока мы ждали тик: шлём выделения
                // того, кто активен сейчас (его uri и едет в payload).
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
        // Правка адресует документ (модель общая) — годится любая вкладка ресурса в любой группе.
        const editor = this.anyEditorFor(uri);
        // Read-only правку отобьёт `EditorViewState`: `TextEditor.edit()` расширения резолвится
        // этим ответом, врать об успехе нельзя (так же VS Code).
        if (editor === null || editor.readOnly || edits.length === 0) return false;
        const textEdits = this.toTextEdits(editor, edits);
        // Перекрытые правки применились бы по съеденному тексту: батч отбиваем целиком,
        // как `Overlapping ranges are not allowed` в vscode.
        if (textEdits === null) return false;
        editor.applyExternalEdits(textEdits, "extension edit");
        return true;
    }

    public async applyWorkspaceEdit(
        ops: readonly IWireWorkspaceEditOp[],
        options?: { isRefactoring?: boolean },
    ): Promise<boolean> {
        // Пустой edit субпроцесс резолвит успехом сам, без RPC; здесь ничего не применено.
        if (ops.length === 0) return false;
        const edits = toWorkspaceEdit(ops);
        // Файловая операция по недисковому ресурсу (`output:`, `jdt:`): отбиваем edit целиком.
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

    /** Позиции клампятся к содержимому; `null` — батч с пересечениями. */
    private toTextEdits(editor: TextEditorPane, edits: readonly IWireEditorEdit[]): ITextEdit[] | null {
        const doc = editor.model.document;
        const textEdits: ITextEdit[] = edits.map((edit) => {
            const start = clampPositionToDocument(doc, edit.range.start);
            const end = clampPositionToDocument(doc, edit.range.end);
            return createTextEdit(createRange(start.line, start.character, end.line, end.character), edit.text);
        });
        return hasOverlappingEdits(textEdits) ? null : textEdits;
    }

    /** С `groupId` — вкладка ресурса в той группе (AS-10), без — активная вкладка с этим uri. */
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

    /** Модель у всех вкладок ресурса одна. */
    private anyEditorFor(uri: string): TextEditorPane | null {
        const active = this.group.getActiveTabEditor();
        if (active !== null && active.uri.toString() === uri) return active;
        return this.group.getEditors().find((editor) => editor.uri.toString() === uri) ?? null;
    }
}

/**
 * Координаты едут как есть — клампит исполнитель. `null` — файловая операция не по диску:
 * весь edit отбивается.
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

/** Первое — первичное. */
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
