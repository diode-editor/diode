export interface IEditorOptionsState {
    readonly tabSize: number;
    readonly insertSpaces: boolean;
}

export interface IEditorOptionsPatch {
    readonly tabSize?: number;
    readonly insertSpaces?: boolean;
}

/**
 * Отдельно от {@link IActiveEditorMeta}: смена выделения — не смена активного
 * редактора, слушатели `onDidChangeActiveTextEditor` дёргаться не должны.
 */
export interface IActiveEditorSelections {
    readonly uri: string;
    /** Первое — первичное. */
    readonly selections: readonly IWireSelection[];
    /** Стабильный id группы: субпроцесс адресует per-editor кэш. */
    readonly groupId?: number;
    /** Нет, если жест не размечен: undo/redo, переход по find (`cursorChangeSource.ts`). */
    readonly kind?: WireSelectionChangeKind;
}

export interface IActiveEditorMeta {
    /** `null` — активного редактора нет. */
    readonly uri: string | null;
    readonly languageId: string | null;
    readonly isDirty: boolean;
    /** id из SUPPORTED_ENCODINGS. */
    readonly encoding: string | null;
    /** `vscode.EndOfLine`: 1=LF, 2=CRLF. */
    readonly eol: 1 | 2 | null;
    readonly selection: IWireSelection | null;
    readonly groupId?: number;
    /** 1..N, производный. */
    readonly viewColumn?: number;
}

import type { IDisposable } from "../../../base/common/lifecycle.ts";

import type { IWireEditorEdit, IWireSelection, IWireWorkspaceEditOp, WireSelectionChangeKind } from "./wireTypes.ts";

export interface IEditorOptionsService {
    getActiveEditorOptions(): IEditorOptionsState | null;
    setActiveEditorOptions(patch: IEditorOptionsPatch): void;
    getActiveEditorFilePath(): string | null;
    getActiveEditorMeta(): IActiveEditorMeta;
    onActiveEditorChanged(cb: (meta: IActiveEditorMeta) => void): IDisposable;
    /** События коалесятся в пределах тика: многошаговая операция даёт одну нотификацию. */
    onActiveEditorSelectionChanged(cb: (selections: IActiveEditorSelections) => void): IDisposable;
    /** No-op, если uri активного не совпадает с `uri`: редактор сменился, пока RPC ехал. */
    setActiveEditorSelections(uri: string, selections: readonly IWireSelection[], groupId?: number): void;
    /** Одним undoable-батчем; `false` — нет активного, uri не совпал или применять нечего. */
    applyActiveEditorEdits(uri: string, edits: readonly IWireEditorEdit[]): boolean;
    /**
     * Одним шагом отмены. All-or-nothing: не прошёл валидацию хоть один ресурс —
     * не применяется ничего, `false`. Пустой список — тоже `false`: успех пустого
     * edit'а субпроцесс отвечает сам. `isRefactoring` — затронутые грязные буферы
     * сохраняются по `files.refactoring.autoSave`.
     */
    applyWorkspaceEdit(ops: readonly IWireWorkspaceEditOp[], options?: { isRefactoring?: boolean }): Promise<boolean>;

    saveAll(includeUntitled: boolean): Promise<boolean>;

    /** `null` — не открыт или не сохранился. */
    save(uri: string): Promise<string | null>;
}
