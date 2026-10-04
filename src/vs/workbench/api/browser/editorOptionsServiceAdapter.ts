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
import type { EditorService } from "../../services/editor/browser/editorService.ts";
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

/**
 * Реализация {@link IEditorOptionsService} поверх {@link EditorService}.
 * Живёт в слое Extensions (Workbench ничего не должен знать про host).
 */
export class EditorOptionsServiceAdapter implements IEditorOptionsService {
    private readonly group: EditorService;
    /**
     * Исполнитель `workspace.applyEdit`: правки по закрытым файлам и файловые
     * операции живут в ядре (node), а не здесь — адаптер только переводит
     * wire-форму в его модель.
     */
    private readonly workspaceEdits: IBulkEditService;

    /** Группа вкладки (для меты/таргетинга); вкладка уже закрыта — фолбэк активная. */
    private groupIdOf(editor: TextEditorPane): number {
        return this.group.groupOf(editor)?.id ?? this.group.activeGroup.id;
    }
    /**
     * Выделение, которое прямо сейчас ставит сам субпроцесс
     * (`TextEditor.selection =`). Присваивание фаерит cursor-change, и без этого
     * флага мы бы отправили расширению обратно то, что оно только что прислало.
     */
    private applyingRemoteSelection = false;
    /** Коалесинг: за тик отправляем одну нотификацию, а не по одной на шаг операции. */
    private selectionFlushScheduled = false;
    /**
     * Источник последней смены каретки в текущем тике. Снимается СИНХРОННО в
     * обработчике (в отложенном флаше область жеста уже закрыта), и побеждает
     * последний: отправляем мы итоговые выделения тика, а не первые.
     */
    private pendingSelectionSource: CursorChangeSource | undefined;

    public constructor(group: EditorService, workspaceEdits: IBulkEditService) {
        this.group = group;
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

    /** Мета + координата группы (groupId/viewColumn) для субпроцесса. */
    private metaOfEditor(editor: TextEditorPane | null): IActiveEditorMeta {
        const base = metaOf(editor);
        if (editor === null) return base;
        const owner = this.group.groupOf(editor) ?? this.group.activeGroup;
        return { ...base, groupId: owner.id, viewColumn: this.group.viewColumnOf(owner) };
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
        // Правка адресует ДОКУМЕНТ (модель общая для всех вкладок ресурса) —
        // достаточно найти любую вкладку с этим uri в любой группе.
        const editor = this.anyEditorFor(uri);
        // Read-only: правка не состоится (её отобьёт `EditorViewState`), поэтому
        // честно отвечаем `false` — у расширения `TextEditor.edit()` резолвится
        // этим значением, и врать ему об успехе нельзя. Так же ведёт себя VS Code.
        if (editor === null || editor.readOnly || edits.length === 0) return false;
        const textEdits = this.toTextEdits(editor, edits);
        // Перекрытые правки документ применил бы по уже съеденному тексту —
        // порча содержимого и сломанный undo. Отбиваем батч целиком, как
        // `Overlapping ranges are not allowed` в vscode: `TextEditor.edit()`
        // резолвится `false`.
        if (textEdits === null) return false;
        editor.applyExternalEdits(textEdits, "extension edit");
        return true;
    }

    public async applyWorkspaceEdit(ops: readonly IWireWorkspaceEditOp[]): Promise<boolean> {
        // Пустой список — мусорный запрос: вакуумный успех пустого edit'а
        // субпроцесс отвечает сам, не отправляя RPC. Здесь ничего не применено —
        // врать `true` нельзя.
        if (ops.length === 0) return false;
        const edits = toWorkspaceEdit(ops);
        // Файловая операция по недисковому ресурсу (`output:`, `jdt:`) —
        // создавать и переименовывать там нечего: отбиваем edit целиком.
        if (edits === null) return false;
        return this.workspaceEdits.applyWorkspaceEdit(edits, "Workspace Edit");
    }

    /**
     * Wire-правки в правки документа: позиции клампятся к содержимому (их автор
     * — расширение, про наш текст оно ничего не знает). `null` — батч с
     * пересечениями, применять его нельзя (см. {@link hasOverlappingEdits}).
     */
    private toTextEdits(editor: TextEditorPane, edits: readonly IWireEditorEdit[]): ITextEdit[] | null {
        const doc = editor.model.document;
        const textEdits: ITextEdit[] = edits.map((edit) => {
            const start = clampPositionToDocument(doc, {
                line: edit.range.startLine,
                character: edit.range.startCharacter,
            });
            const end = clampPositionToDocument(doc, { line: edit.range.endLine, character: edit.range.endCharacter });
            return createTextEdit(createRange(start.line, start.character, end.line, end.character), edit.text);
        });
        return hasOverlappingEdits(textEdits) ? null : textEdits;
    }

    /**
     * Редактор-адресат: с `groupId` — вкладка ресурса в ТОЙ группе (AS-10:
     * выделение ставится конкретной вью); без — активная вкладка с этим uri.
     */
    private editorFor(uri: string, groupId?: number): TextEditorPane | null {
        if (groupId !== undefined) {
            const target = this.group.groups.find((candidate) => candidate.id === groupId);
            if (target === undefined) return null;
            const index = target.findPaneIndex(Uri.parse(uri));
            const pane = index >= 0 ? target.getPane(index) : null;
            return pane instanceof TextEditorPane ? pane : null;
        }
        const editor = this.group.getActiveTabEditor();
        if (editor?.uri.toString() !== uri) return null;
        return editor;
    }

    /** Любая текстовая вкладка ресурса (модель у всех одна). */
    private anyEditorFor(uri: string): TextEditorPane | null {
        const active = this.group.getActiveTabEditor();
        if (active !== null && active.uri.toString() === uri) return active;
        return this.group.getEditors().find((editor) => editor.uri.toString() === uri) ?? null;
    }
}

/**
 * Переводит операции провода в модель правок ядра. Координаты правок едут как
 * есть — клампит их сам исполнитель (у закрытого ресурса их не к чему
 * приложить здесь). `null` — файловая операция адресует НЕ диск: создавать,
 * удалять и переименовывать там нечего, и весь edit отбивается.
 */
function toWorkspaceEdit(ops: readonly IWireWorkspaceEditOp[]): BulkEdit | null {
    const result: BulkEditOperation[] = [];
    for (const op of ops) {
        if (op.kind === "text") {
            result.push({ resource: op.resource, edits: op.edits.map(toTextEdit) });
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

/** Путь на диске за ресурсом; `null` — схема не `file`. */
function filePathOf(resource: string): string | null {
    const uri = Uri.parse(resource);
    return uri.scheme === "file" ? uri.fsPath : null;
}

/** Wire-правка в правку ядра БЕЗ клампа (клампит исполнитель по содержимому ресурса). */
function toTextEdit(edit: IWireEditorEdit): ITextEdit {
    return createTextEdit(
        createRange(edit.range.startLine, edit.range.startCharacter, edit.range.endLine, edit.range.endCharacter),
        edit.text,
    );
}

/** Все выделения редактора в wire-форме (первое — первичное). */
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
