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
import type { TextFileModel } from "../../textfile/common/textFileModel.ts";
import type { TextFileModelService } from "../../textfile/common/textFileModelService.ts";
import type { EditorGroup } from "../browser/editorGroupModel.ts";
import type { IEditorPaneFactory, ITextEditorViewState } from "../browser/editorPaneFactory.ts";
import type { TextEditorConfiguration } from "../browser/textEditorConfiguration.ts";

import type { IEditorGroupsService } from "./editorGroupsService.ts";
import type { IVirtualDocumentSource } from "./iVirtualDocumentSource.ts";

/** `$tryCreateDocument` эталона. */
export interface IUntitledOptions {
    /** Непустой делает буфер изменённым, как в эталоне. */
    readonly content?: string | undefined;
    readonly languageId?: string | undefined;
    readonly encoding?: string | undefined;
}

export interface IOpenUriOptions {
    readonly focus?: boolean;
    /** Группа — ровно в неё (повтор вкладки по рецепту). */
    readonly group?: "beside" | EditorGroup;
    /** У уже открытой вкладки не трогаются. */
    readonly viewState?: ITextEditorViewState;
    /**
     * Вкладка превью в группе одна, следующее превью занимает её слот. Просят только двери,
     * где эталон тоже превьюит (дерево Explorer); гасится `workbench.editor.enablePreview`.
     */
    readonly preview?: boolean;
}

export interface IEditorSavedMeta {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
}

/**
 * Аналог `IEditorService`; полоса групп — отдельная роль ({@link IEditorGroupsService}).
 * Узкие швы фич (`IGotoLineEditorSource`, …) остаются своими интерфейсами: они уже ролевые.
 */
export interface IEditorService extends IShutdownParticipant, IActivatable, IDisposable {
    /** При фокусе в detached-панели — она. */
    getActivePane(): IEditorPane | null;
    /** Без учёта detached-панелей. */
    getActiveTabPane(): IEditorPane | null;
    /** Сторона диффа — тоже. */
    getActiveEditor(): TextEditorPane | null;
    /** Без учёта detached-панелей. */
    getActiveTabEditor(): TextEditorPane | null;
    getActiveViewState(): EditorViewState | null;
    focusEditor(): void;
    /** Переключение на дифф — `null`. */
    readonly onActiveEditorChanged: Event<TextEditorPane | null>;
    readonly onDidChangeActiveEditorSelection: Event<TextEditorPane>;

    /** ВСЕХ групп. */
    getEditors(): readonly TextEditorPane[];
    /**
     * Вкладки и стороны дифф-вкладок (сторона бывает правимой моделью без своей вкладки): по
     * ним зовут языковых провайдеров, их документы синхронизируются с host'ом. Output — нет.
     */
    getTextSurfaces(): readonly TextEditorPane[];
    /** Документы уже открыты расширениям, но человек их ещё не видит. */
    getUntitledModelsWithoutEditor(): readonly TextFileModel[];
    /** В порядке вкладок, без безымянных и недисковых. */
    getOpenFilePaths(): string[];
    /** Изменённые на диске не перезаписывает. `true` — сохранено всё. */
    saveAll(options?: { includeUntitled?: boolean }): Promise<boolean>;
    /** `undefined` — не открыт или не сохранился. */
    save(resource: Uri): Promise<Uri | undefined>;
    readonly onDidChangeEditors: Event<void>;
    readonly onEditorSaved: Event<IEditorSavedMeta>;
    displayName(editor: IEditorPane): string;
    suggestedSaveName(editor: TextEditorPane): string;

    openFile(filePath: string, options?: IOpenUriOptions): void;
    openUri(uri: Uri, options?: IOpenUriOptions): Promise<void>;
    openPane(pane: IEditorPane, options?: { focus?: boolean; group?: EditorGroup }): void;
    /** Read-only, содержимое вызывающего (файл на ревизии). */
    openTextSnapshot(
        uri: Uri,
        options: { text: string; languageId: string; label: string; focus?: boolean },
    ): TextEditorPane;
    /** Вне таб-строки (нижняя панель Output). */
    openDetached(uri: Uri, languageId: string): TextEditorPane<SyntheticTextModel>;
    newUntitled(options?: { focus?: boolean }): void;
    /** `workspace.openTextDocument({ content, language })`; показывает его {@link openUri}. */
    createUntitled(options?: IUntitledOptions): Uri;
    canRestore(uri: Uri): boolean;
    readonly onDidFailOpen: Event<{ readonly uri: Uri; readonly reason: string }>;

    splitActiveGroup(options?: { focus?: boolean; position?: "before" | "after" }): EditorGroup | null;
    copyActiveEditorToGroup(direction: "next" | "previous", options?: { focus?: boolean }): void;
    serializeEditor(pane: IEditorPane): ISerializedEditor | undefined;
    deserializeEditor(
        entry: ISerializedEditor,
    ): { factory: IEditorPaneFactory<unknown>; descriptor: unknown } | undefined;
    openSerializedEditor(entry: ISerializedEditor, target: { group: EditorGroup; focus: boolean }): void;

    closeEditor(group: EditorGroup, target: IEditorPane | number): Promise<boolean>;
    closeEditors(group: EditorGroup, panes: readonly IEditorPane[]): Promise<boolean>;
    closeAllEditors(group: EditorGroup): Promise<boolean>;
    /**
     * Удаление через файловый сервис доходит само (`FileOperation.Delete`); зовут те, кто
     * удаляет мимо сервиса (корзина).
     */
    handleDeletedFile(resource: Uri): void;
    /** Документ больше нигде не виден. */
    needsCloseConfirm(pane: IEditorPane): boolean;
    dirtyExclusiveDiffSides(pane: DiffEditorPane2): TextEditorPane[];

    readonly editorGroups: IEditorGroupsService;
    readonly textFileModels: TextFileModelService;
    readonly editorConfiguration: TextEditorConfiguration;
    /** `onWillSaveTextDocument`. */
    saveParticipant: SaveParticipant | undefined;
    /** `registerTextDocumentContentProvider`. */
    virtualDocumentSource: IVirtualDocumentSource;
    /** По `onDidChange` провайдера. */
    refreshVirtualDocument(uri: Uri): void;
}

export const EditorServiceDIToken = token<IEditorService>("EditorService");
