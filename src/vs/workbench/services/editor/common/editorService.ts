import type { Event } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import type { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IActivatable } from "../../../browser/iActivatable.ts";
import type { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { SyntheticTextModel } from "../../../common/editor/syntheticTextModel.ts";
import type { ISerializedEditor } from "../../../common/stateKeys.ts";
import type { IShutdownParticipant } from "../../lifecycle/browser/lifecycleService.ts";
import type { SaveParticipant } from "../../textfile/common/iSaveParticipant.ts";
import type { TextFileModelService } from "../../textfile/common/textFileModelService.ts";
import type { EditorGroup } from "../browser/editorGroupModel.ts";
import type { IEditorPaneFactory, ITextEditorViewState } from "../browser/editorPaneFactory.ts";
import type { TextEditorConfiguration } from "../browser/textEditorConfiguration.ts";

import type { IEditorGroupsService } from "./editorGroupsService.ts";
import type { IVirtualDocumentSource } from "./iVirtualDocumentSource.ts";

/** Параметры {@link IEditorService.openUri}. */
export interface IOpenUriOptions {
    readonly focus?: boolean;
    /**
     * Куда открыть: по умолчанию — активная группа; `"beside"` — соседняя справа
     * (создаётся при отсутствии); группа — ровно в неё (повтор вкладки по рецепту).
     */
    readonly group?: "beside" | EditorGroup;
    /** Каретка и скролл новой вкладки (у уже открытой вкладки не трогаются). */
    readonly viewState?: ITextEditorViewState;
    /**
     * Открыть вкладкой-ПРЕДПРОСМОТРА: такая вкладка в группе одна, и следующее
     * превью занимает её слот. Просят только те двери, где эталон тоже превьюит
     * (дерево Explorer); остальные открывают постоянную вкладку. Гасится
     * настройкой `workbench.editor.enablePreview`.
     */
    readonly preview?: boolean;
}

/** Метаданные сохранённого редактора для проекции в subprocess (did-save). */
export interface IEditorSavedMeta {
    /** Ресурс как `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
}

/**
 * «Редакторы» воркбенча — аналог upstream `IEditorService`: активный редактор,
 * все редакторы, открытие ресурсов и вкладок, закрытие с подтверждением,
 * события. Полоса групп — отдельная роль ({@link IEditorGroupsService},
 * доступна и как {@link editorGroups}). Реализация — `EditorService`
 * (`services/editor/browser/editorService.ts`).
 *
 * Узкие швы фич (`IGotoLineEditorSource`, `IDiagnosticsEditorSource`, …)
 * остаются своими интерфейсами: они уже ролевые. Жизненный цикл — как у
 * сервиса воркбенча: активация, участие в shutdown (несохранённые
 * редакторы), dispose.
 */
export interface IEditorService extends IShutdownParticipant, IActivatable, IDisposable {
    // ─── Активный редактор ───────────────────────────────────────────────────

    /** Активная панель любого вида; при фокусе в detached-панели — она. */
    getActivePane(): IEditorPane | null;
    /** Активная вкладка — без учёта detached-панелей. */
    getActiveTabPane(): IEditorPane | null;
    /** Активный текстовый редактор (сторона диффа — тоже); иначе `null`. */
    getActiveEditor(): TextEditorPane | null;
    /** Активная текстовая вкладка — без учёта detached-панелей. */
    getActiveTabEditor(): TextEditorPane | null;
    /** View-состояние активного текстового редактора. */
    getActiveViewState(): EditorViewState | null;
    /** Фокус активной вкладки любого вида. */
    focusEditor(): void;
    /** Смена активного текстового редактора (переключение на дифф — `null`). */
    readonly onActiveEditorChanged: Event<TextEditorPane | null>;
    /** Смена курсора/выделения в активном редакторе. */
    readonly onDidChangeActiveEditorSelection: Event<TextEditorPane>;

    // ─── Все редакторы ───────────────────────────────────────────────────────

    /** Открытые текстовые редакторы ВСЕХ групп. */
    getEditors(): readonly TextEditorPane[];
    /**
     * Текстовые поверхности документов: вкладки и стороны дифф-вкладок (сторона
     * диффа бывает правимой моделью файла без своей вкладки). По ним зовут
     * языковых провайдеров, поэтому их документы синхронизируются с extension
     * host'ом. Панели вне таб-строки (Output) сюда не входят — см.
     * `bindDocumentSync`.
     */
    getTextSurfaces(): readonly TextEditorPane[];
    /** Пути открытых файлов всех групп в порядке вкладок (без безымянных и недисковых). */
    getOpenFilePaths(): string[];
    /** Вкладки, метки или активная вкладка поменялись. */
    readonly onDidChangeEditors: Event<void>;
    /** Сохранение любого редактора. */
    readonly onEditorSaved: Event<IEditorSavedMeta>;
    /** Имя вкладки для меток и пикеров. */
    displayName(editor: IEditorPane): string;
    /** Имя файла, предлагаемое в Save As. */
    suggestedSaveName(editor: TextEditorPane): string;

    // ─── Открытие ────────────────────────────────────────────────────────────

    openFile(filePath: string, options?: IOpenUriOptions): void;
    openUri(uri: Uri, options?: IOpenUriOptions): Promise<void>;
    /** Готовая панель не-текстового вида — в активную группу либо в указанную. */
    openPane(pane: IEditorPane, options?: { focus?: boolean; group?: EditorGroup }): void;
    /** Текстовая read-only вкладка с содержимым вызывающего (файл на ревизии). */
    openTextSnapshot(
        uri: Uri,
        options: { text: string; languageId: string; label: string; focus?: boolean },
    ): TextEditorPane;
    /** Редактор вне таб-строки (нижняя панель Output). */
    openDetached(uri: Uri, languageId: string): TextEditorPane<SyntheticTextModel>;
    /** Новый безымянный буфер. */
    newUntitled(options?: { focus?: boolean }): void;
    /** Сможет ли {@link openUri} открыть этот ресурс заново. */
    canRestore(uri: Uri): boolean;
    /** Ресурс открыть не удалось. */
    readonly onDidFailOpen: Event<{ readonly uri: Uri; readonly reason: string }>;

    // ─── Повтор вкладки по рецепту ───────────────────────────────────────────

    splitActiveGroup(options?: { focus?: boolean; position?: "before" | "after" }): EditorGroup | null;
    copyActiveEditorToGroup(direction: "next" | "previous", options?: { focus?: boolean }): void;
    serializeEditor(pane: IEditorPane): ISerializedEditor | undefined;
    deserializeEditor(
        entry: ISerializedEditor,
    ): { factory: IEditorPaneFactory<unknown>; descriptor: unknown } | undefined;
    openSerializedEditor(entry: ISerializedEditor, target: { group: EditorGroup; focus: boolean }): void;

    // ─── Закрытие с подтверждением ───────────────────────────────────────────

    closeEditor(group: EditorGroup, target: IEditorPane | number): Promise<boolean>;
    closeEditors(group: EditorGroup, panes: readonly IEditorPane[]): Promise<boolean>;
    closeAllEditors(group: EditorGroup): Promise<boolean>;
    /** Спросит ли закрытие вкладки о несохранённом (документ больше нигде не виден). */
    needsCloseConfirm(pane: IEditorPane): boolean;
    /** Изменённые стороны дифф-вкладки, которых нет больше ни на одной поверхности. */
    dirtyExclusiveDiffSides(pane: DiffEditorPane2): TextEditorPane[];

    // ─── Части и швы host'а ──────────────────────────────────────────────────

    /** Полоса групп. */
    readonly editorGroups: IEditorGroupsService;
    /** Модели файлов и безымянных буферов. */
    readonly textFileModels: TextFileModelService;
    /** Применение `editor.*`-настроек (стороны диффа, Alt+Z). */
    readonly editorConfiguration: TextEditorConfiguration;
    /** Save-участник расширений (`onWillSaveTextDocument`). */
    saveParticipant: SaveParticipant | undefined;
    /** Источник содержимого недисковых ресурсов (`registerTextDocumentContentProvider`). */
    virtualDocumentSource: IVirtualDocumentSource;
    /** Перечитать открытую вкладку недискового ресурса (`onDidChange` провайдера). */
    refreshVirtualDocument(uri: Uri): void;
}

export const EditorServiceDIToken = token<IEditorService>("EditorService");
