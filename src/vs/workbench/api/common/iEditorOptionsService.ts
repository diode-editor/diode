/**
 * Снимок настроек редактора, относящихся к indent. В Phase 1 — только
 * `tabSize`/`insertSpaces`. По мере реализации API сюда добавятся другие
 * `TextEditorOptions` (например, `cursorStyle`, `lineNumbers`).
 */
export interface IEditorOptionsState {
    readonly tabSize: number;
    readonly insertSpaces: boolean;
}

export interface IEditorOptionsPatch {
    readonly tabSize?: number;
    readonly insertSpaces?: boolean;
}

/**
 * Выделения активного редактора, проецируемые в subprocess на каждое движение
 * каретки (`editor.selectionChanged`). Отдельно от {@link IActiveEditorMeta},
 * потому что смена выделения — не смена активного редактора: слушатели
 * `onDidChangeActiveTextEditor` на неё дёргаться не должны.
 */
export interface IActiveEditorSelections {
    /** Ресурс редактора, которому принадлежат выделения (`uri.toString()`). */
    readonly uri: string;
    /** Все выделения, первое — первичное. */
    readonly selections: readonly IWireSelection[];
    /** Группа редактора (стабильный id) — субпроцесс адресует per-editor кэш. */
    readonly groupId?: number;
}

/**
 * Метаданные активного редактора, проецируемые в subprocess на смене фокуса
 * (`editor.activeEditorChanged`). Только метаданные — без текста (полный снапшот
 * приходит лишь на пути will-save, WP6).
 */
export interface IActiveEditorMeta {
    /** Ресурс активного документа как `uri.toString()`; `null` — активного редактора нет. */
    readonly uri: string | null;
    readonly languageId: string | null;
    readonly isDirty: boolean;
    /** Кодировка дискового представления (id из SUPPORTED_ENCODINGS); `null` — нет редактора. */
    readonly encoding: string | null;
    /** Текущий EOL (`vscode.EndOfLine`: 1=LF, 2=CRLF); `null` — нет редактора. */
    readonly eol: 1 | 2 | null;
    /** Первичное выделение активного редактора; `null` — нет редактора. */
    readonly selection: IWireSelection | null;
    /** Группа активного редактора (стабильный id); нет редактора — отсутствует. */
    readonly groupId?: number;
    /** Номер колонки группы (1..N, производный). */
    readonly viewColumn?: number;
}

import type { IDisposable } from "@tuidom/all/common/disposable";

import type { IWireEditorEdit, IWireSelection } from "./wireTypes.ts";

/**
 * Тонкий «port» поверх {@link EditorService}, нужный
 * {@link ExtensionHost} для применения изменений `TextEditor.options`
 * к активному редактору без прямого знания о слоях Workbench/Editor
 * внутри runtime'а расширения. С #194 — также чтение/запись выделения и
 * применение правок `TextEditor.edit`.
 */
export interface IEditorOptionsService {
    getActiveEditorOptions(): IEditorOptionsState | null;
    setActiveEditorOptions(patch: IEditorOptionsPatch): void;
    getActiveEditorFilePath(): string | null;
    /** Метаданные активного редактора для проекции в subprocess. */
    getActiveEditorMeta(): IActiveEditorMeta;
    onActiveEditorChanged(cb: (meta: IActiveEditorMeta) => void): IDisposable;
    /**
     * Смена курсора/выделения в активном редакторе. События коалесятся в пределах
     * тика — многошаговая операция редактора даёт одну нотификацию, а не пачку.
     */
    onActiveEditorSelectionChanged(cb: (selections: IActiveEditorSelections) => void): IDisposable;
    /**
     * Устанавливает выделения активного редактора (`TextEditor.selection(s) =`).
     * No-op, если активного редактора нет либо его uri не совпадает с `uri`
     * (редактор сменился, пока RPC ехал).
     */
    setActiveEditorSelections(uri: string, selections: readonly IWireSelection[], groupId?: number): void;
    /**
     * Применяет правки к активному редактору одним undoable-батчем
     * (`TextEditor.edit`). Возвращает `false`, если активного редактора нет,
     * его uri не совпадает с `uri`, либо применять нечего.
     */
    applyActiveEditorEdits(uri: string, edits: readonly IWireEditorEdit[]): boolean;
}
