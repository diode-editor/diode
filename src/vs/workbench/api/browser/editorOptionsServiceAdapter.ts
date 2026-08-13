import type { IDisposable } from "@tuidom/all/common/disposable";
import { Uri } from "../../../base/common/uri.ts";
import { createRange } from "../../../editor/common/core/iRange.ts";
import { createSelection, type ISelection } from "../../../editor/common/core/iSelection.ts";
import { createTextEdit, type ITextEdit } from "../../../editor/common/core/iTextEdit.ts";
import { TextEditorPane } from "../../browser/parts/editor/textEditorPane.ts";
import type { EditorService } from "../../services/editor/browser/editorService.ts";
import type {
    IActiveEditorMeta,
    IActiveEditorSelections,
    IEditorOptionsPatch,
    IEditorOptionsService,
    IEditorOptionsState,
} from "../common/iEditorOptionsService.ts";
import type { IWireEditorEdit, IWireSelection } from "../common/wireTypes.ts";

/**
 * Реализация {@link IEditorOptionsService} поверх {@link EditorService}.
 * Живёт в слое Extensions (Workbench ничего не должен знать про host).
 */
export class EditorOptionsServiceAdapter implements IEditorOptionsService {
    private readonly group: EditorService;

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

    public constructor(group: EditorService) {
        this.group = group;
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
            if (this.selectionFlushScheduled) return;
            this.selectionFlushScheduled = true;
            queueMicrotask(() => {
                this.selectionFlushScheduled = false;
                // Активный редактор мог смениться, пока мы ждали тик: шлём выделения
                // того, кто активен сейчас (его uri и едет в payload).
                const current = this.group.getActiveTabEditor() ?? editor;
                cb({
                    uri: current.uri.toString(),
                    selections: wireSelectionsOf(current),
                    groupId: this.groupIdOf(current),
                });
            });
        });
    }

    public setActiveEditorSelections(uri: string, selections: readonly IWireSelection[], groupId?: number): void {
        const editor = this.editorFor(uri, groupId);
        if (editor === null || selections.length === 0) return;
        const doc = editor.model.document;
        const mapped: ISelection[] = selections.map((sel) => {
            const anchor = clampPosition(doc, sel.anchorLine, sel.anchorCharacter);
            const active = clampPosition(doc, sel.activeLine, sel.activeCharacter);
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
        const doc = editor.model.document;
        const textEdits: ITextEdit[] = edits.map((edit) => {
            const start = clampPosition(doc, edit.range.startLine, edit.range.startCharacter);
            const end = clampPosition(doc, edit.range.endLine, edit.range.endCharacter);
            return createTextEdit(createRange(start.line, start.character, end.line, end.character), edit.text);
        });
        editor.applyExternalEdits(textEdits, "extension edit");
        return true;
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
        if (editor === null || editor.uri.toString() !== uri) return null;
        return editor;
    }

    /** Любая текстовая вкладка ресурса (модель у всех одна). */
    private anyEditorFor(uri: string): TextEditorPane | null {
        const active = this.group.getActiveTabEditor();
        if (active !== null && active.uri.toString() === uri) return active;
        return this.group.getEditors().find((editor) => editor.uri.toString() === uri) ?? null;
    }
}

function clampPosition(
    doc: { lineCount: number; getLineLength(line: number): number },
    line: number,
    character: number,
): { line: number; character: number } {
    const maxLine = doc.lineCount - 1;
    const clampedLine = line < 0 ? 0 : line > maxLine ? maxLine : line;
    const maxChar = doc.getLineLength(clampedLine);
    const clampedChar = character < 0 ? 0 : character > maxChar ? maxChar : character;
    return { line: clampedLine, character: clampedChar };
}

/** Все выделения редактора в wire-форме (первое — первичное). */
function wireSelectionsOf(editor: TextEditorPane): IWireSelection[] {
    return (editor.viewState?.selections ?? []).map((sel) => ({
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
        eol: editor.eol === 2 ? 2 : 1,
        selection,
    };
}
