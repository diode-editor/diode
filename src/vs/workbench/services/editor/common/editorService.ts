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

/** Upstream `$tryCreateDocument`. */
export interface IUntitledOptions {
    /** Non-empty makes the buffer dirty, as upstream. */
    readonly content?: string | undefined;
    readonly languageId?: string | undefined;
    readonly encoding?: string | undefined;
}

export interface IOpenUriOptions {
    readonly focus?: boolean;
    /** A group means exactly that group (replaying a tab from a recipe). */
    readonly group?: "beside" | EditorGroup;
    /** Left untouched on an already open tab. */
    readonly viewState?: ITextEditorViewState;
    /**
     * A group has one preview tab; the next preview takes its slot. Only entry points where
     * upstream also previews (the Explorer tree) ask for it; `workbench.editor.enablePreview` turns it off.
     */
    readonly preview?: boolean;
}

export interface IEditorSavedMeta {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
}

/**
 * Counterpart of `IEditorService`; the group strip is a separate role ({@link IEditorGroupsService}).
 * Narrow feature seams (`IGotoLineEditorSource`, …) keep their own interfaces: they are already role-based.
 */
export interface IEditorService extends IShutdownParticipant, IActivatable, IDisposable {
    /** The detached pane when it has focus. */
    getActivePane(): IEditorPane | null;
    /** Ignores detached panes. */
    getActiveTabPane(): IEditorPane | null;
    /** Includes a diff side. */
    getActiveEditor(): TextEditorPane | null;
    /** Ignores detached panes. */
    getActiveTabEditor(): TextEditorPane | null;
    getActiveViewState(): EditorViewState | null;
    focusEditor(): void;
    /** Switching to a diff fires `null`. */
    readonly onActiveEditorChanged: Event<TextEditorPane | null>;
    readonly onDidChangeActiveEditorSelection: Event<TextEditorPane>;
    /** The visible tab of a group, other than the active editor. */
    readonly onDidChangeInactiveEditorSelection: Event<TextEditorPane>;

    /** Across ALL groups. */
    getEditors(): readonly TextEditorPane[];
    /**
     * Tabs and diff tab sides (a side can be an editable model without a tab of its own): language
     * providers are called for them, and their documents sync with the host. Output is not included.
     */
    getTextSurfaces(): readonly TextEditorPane[];
    /** Documents already open for extensions but not yet visible to the user. */
    getUntitledModelsWithoutEditor(): readonly TextFileModel[];
    /** Upstream `$tryOpenDocument`: extensions see the document, a tab may never appear. Bounded in age and number while clean. */
    getFileModelsWithoutEditor(): readonly TextFileModel[];
    /** Upstream's working copy file service: dirty models at or under the resource stop being unsaved. */
    revertSoftBeforeDelete(resource: Uri): void;
    /** `false`: not a readable file. */
    openTextDocumentWithoutEditor(uri: Uri): Promise<boolean>;
    /** Synchronous, for a file known to exist: {@link getFileModelsWithoutEditor}. `null`: not a file resource. */
    holdFileModel(uri: Uri): TextFileModel | null;
    /** In tab order, without untitled and non-disk ones. */
    getOpenFilePaths(): string[];
    /** Doesn't overwrite files changed on disk. `true` means everything was saved. */
    saveAll(options?: { includeUntitled?: boolean }): Promise<boolean>;
    /** Modified buffers of these groups, one per model: tabs in strip order, then diff sides. */
    getDirtyEditors(groups: readonly EditorGroup[]): readonly TextEditorPane[];
    /** `undefined`: not open or not saved. */
    save(resource: Uri): Promise<Uri | undefined>;
    readonly onDidChangeEditors: Event<void>;
    readonly onEditorSaved: Event<IEditorSavedMeta>;
    displayName(editor: IEditorPane): string;
    suggestedSaveName(editor: TextEditorPane): string;

    openFile(filePath: string, options?: IOpenUriOptions): void;
    openUri(uri: Uri, options?: IOpenUriOptions): Promise<void>;
    openPane(pane: IEditorPane, options?: { focus?: boolean; group?: EditorGroup }): void;
    /** Read-only, with caller-supplied content (a file at a revision). */
    openTextSnapshot(
        uri: Uri,
        options: { text: string; languageId: string; label: string; focus?: boolean },
    ): TextEditorPane;
    /** Outside the tab bar (the bottom Output panel). */
    openDetached(uri: Uri, languageId: string): TextEditorPane<SyntheticTextModel>;
    newUntitled(options?: { focus?: boolean }): void;
    /** `workspace.openTextDocument({ content, language })`; {@link openUri} shows it. */
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
     * Deletes through the file service arrive on their own (`FileOperation.Delete`); callers are
     * those that delete bypassing the service (trash).
     */
    handleDeletedFile(resource: Uri): void;
    /** The document is not visible anywhere else. */
    needsCloseConfirm(pane: IEditorPane): boolean;
    dirtyExclusiveDiffSides(pane: DiffEditorPane2): TextEditorPane[];

    readonly editorGroups: IEditorGroupsService;
    readonly textFileModels: TextFileModelService;
    readonly editorConfiguration: TextEditorConfiguration;
    /** `onWillSaveTextDocument`. */
    saveParticipant: SaveParticipant | undefined;
    /** `registerTextDocumentContentProvider`. */
    virtualDocumentSource: IVirtualDocumentSource;
    /** On the provider's `onDidChange`. */
    refreshVirtualDocument(uri: Uri): void;
}

export const EditorServiceDIToken = token<IEditorService>("EditorService");
