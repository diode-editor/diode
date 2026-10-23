import * as path from "node:path";

import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable, toDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageConfigurationService } from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import {
    LanguageConfigurationServiceDIToken,
    NULL_LANGUAGE_CONFIGURATION_SERVICE,
} from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { LanguageServiceDIToken } from "../../../../editor/common/languages/iLanguageService.ts";
import type { ITokenStyleResolver } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenStyleResolverDIToken } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import type { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { TokenizationRegistryDIToken } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import type { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import type { ContextMenuController } from "../../../../editor/contrib/contextmenu/browser/contextMenuController.ts";
import { ContextMenuControllerDIToken } from "../../../../editor/contrib/contextmenu/browser/contextMenuController.ts";
import { hasDocumentFormatter } from "../../../../editor/contrib/format/format.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { FileOperation, type IFileService, IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import { FileService } from "../../../../platform/files/common/fileService.ts";
import type { IFileWatcher } from "../../../../platform/files/common/iFileWatcher.ts";
import { IFileWatcherDIToken } from "../../../../platform/files/common/iFileWatcherDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ILogService } from "../../../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../../../platform/log/common/iLogServiceDIToken.ts";
import { UndoRedoService, UndoRedoServiceDIToken } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import type { IActivatable } from "../../../browser/iActivatable.ts";
import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { isTextEditorPane, TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { SyntheticTextModel } from "../../../common/editor/syntheticTextModel.ts";
import type { BaseTextEditorModel } from "../../../common/editor/textEditorModel.ts";
import type { ISerializedEditor } from "../../../common/stateKeys.ts";
import { DialogService, DialogServiceDIToken } from "../../dialogs/browser/dialogService.ts";
import type { IShutdownDirtyItem, IShutdownParticipant } from "../../lifecycle/browser/lifecycleService.ts";
import type { SaveParticipant } from "../../textfile/common/iSaveParticipant.ts";
import type { SaveOutcome, TextFileModel } from "../../textfile/common/textFileModel.ts";
import { TextFileModelService, TextFileModelServiceDIToken } from "../../textfile/common/textFileModelService.ts";
import type { ThemeService } from "../../themes/common/themeService.ts";
import { ThemeServiceDIToken } from "../../themes/common/themeTokens.ts";
import { findGroup, peekGroup } from "../common/editorGroupFinder.ts";
import type { IEditorGroupsService } from "../common/editorGroupsService.ts";
import { EditorGroupsServiceDIToken } from "../common/editorGroupsService.ts";
import type { IEditorSavedMeta, IEditorService, IOpenUriOptions, IUntitledOptions } from "../common/editorService.ts";
import type { IVirtualDocumentSource } from "../common/iVirtualDocumentSource.ts";
import { NULL_VIRTUAL_DOCUMENT_SOURCE } from "../common/iVirtualDocumentSource.ts";

import { EditorCloseHandler } from "./editorCloseHandler.ts";
import type { EditorGroup } from "./editorGroupModel.ts";
import { EditorGroupsService } from "./editorGroupsService.ts";
import {
    createTextEditorPaneFactory,
    EditorPaneFactoriesDIToken,
    type IEditorPaneFactory,
    type ITextEditorViewState,
} from "./editorPaneFactory.ts";
import {
    createCodeActionsOnSaveParticipant,
    createFormatOnSaveParticipant,
    enabledCodeActionKindsOnSave,
    type IOnSaveParticipantHost,
} from "./onSaveParticipants.ts";
import { TextEditorConfiguration } from "./textEditorConfiguration.ts";
import { TextEditorPaneBuilder, TextEditorPaneBuilderDIToken } from "./textEditorPaneBuilder.ts";

const PREVIEW_SETTING_KEY = "workbench.editor.enablePreview";

const CLOSE_ON_FILE_DELETE_SETTING_KEY = "workbench.editor.closeOnFileDelete";

/** Not `String(error)`: for an Error it would add the "Error: " prefix. */
function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** No reveal: the position comes from a tab where it was already visible. */
function applyViewState(editor: TextEditorPane, viewState: ITextEditorViewState): void {
    editor.viewState.selections = [...viewState.selections];
    editor.viewState.scrollTop = viewState.scrollTop;
    editor.viewState.scrollLeft = viewState.scrollLeft;
}

/** `null`: the move didn't touch the resource (upstream: `isEqualOrParent` + `joinPath` in `EditorService.handleMovedFile`). */
export function movedResource(resource: Uri, source: Uri, target: Uri): Uri | null {
    // Paths compare only within one scheme: an untitled buffer's "path" is relative.
    if (resource.scheme !== source.scheme) return null;
    const relative = path.relative(source.fsPath, resource.fsPath);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    return Uri.file(path.join(target.fsPath, relative));
}

function holdsFocus(view: IEditorPane["view"]): boolean {
    // Stryker disable next-line OptionalChaining: the root of a mounted tree always has a FocusManager; for an unmounted tab `getRoot()` is `null` anyway
    const active = view.getRoot()?.focusManager?.activeElement ?? null;
    return active?.getAncestorPath().includes(view) === true;
}

/** Counterpart of upstream `EditorService`. Knows nothing of `EditorGroupComponent`: it subscribes to its own group. */
export class EditorService extends Disposable implements IEditorService, IShutdownParticipant, IActivatable {
    public static dependencies = [
        ThemeServiceDIToken,
        TokenizationRegistryDIToken,
        TokenStyleResolverDIToken,
        LanguageServiceDIToken,
        IConfigurationServiceDIToken,
        UndoRedoServiceDIToken,
        IFileWatcherDIToken,
        ContextMenuControllerDIToken,
        ILogServiceDIToken,
        LanguageConfigurationServiceDIToken,
        DialogServiceDIToken,
        EditorPaneFactoriesDIToken,
        LanguageFeaturesServiceDIToken,
        IFileServiceDIToken,
        TextFileModelServiceDIToken,
        TextEditorPaneBuilderDIToken,
        EditorGroupsServiceDIToken,
    ] as const;

    public readonly editorGroups: IEditorGroupsService;
    /** Editors outside the tab bar (Output): tab code doesn't know them; a detached pane shows up only in {@link getActivePane}. */
    private detachedPanes: TextEditorPane[] = [];
    private themeService: ThemeService;
    private languageService: ILanguageService;
    private configurationService: IConfigurationService;
    public readonly editorConfiguration: TextEditorConfiguration;
    private undoRedoService: UndoRedoService;
    private readonly logger: ILogger;
    private readonly paneFactories: readonly IEditorPaneFactory<unknown>[];
    private readonly closeHandler: EditorCloseHandler;
    private readonly onActiveEditorChangedEmitter = new Emitter<TextEditorPane | null>();
    private readonly onEditorSavedEmitter = new Emitter<IEditorSavedMeta>();
    private readonly onDidChangeEditorsEmitter = new Emitter<void>();
    private readonly onDidChangeActiveEditorSelectionEmitter = new Emitter<TextEditorPane>();
    private activeSelectionSubscription?: IDisposable;
    private saveParticipantValue?: SaveParticipant;
    public readonly textFileModels: TextFileModelService;
    private readonly paneBuilder: TextEditorPaneBuilder;

    public virtualDocumentSource: IVirtualDocumentSource = NULL_VIRTUAL_DOCUMENT_SOURCE;

    private readonly onDidFailOpenEmitter = new Emitter<{ readonly uri: Uri; readonly reason: string }>();
    /**
     * No dependency on `NotificationService` on purpose: showing the message is the composition's job. Staying
     * silent is not an option: Go to Definition into a library without a provider would look like "the key is broken".
     */
    public readonly onDidFailOpen = this.onDidFailOpenEmitter.event;

    /** The service owns the model until the first {@link openUri} hands it to a tab. */
    private readonly untitledWithoutEditor = new Map<string, TextFileModel>();

    /** Read at save time, so an assignment also reaches already open editors. */
    public get saveParticipant(): SaveParticipant | undefined {
        return this.saveParticipantValue;
    }

    public set saveParticipant(participant: SaveParticipant | undefined) {
        this.saveParticipantValue = participant;
    }

    /** The subscription follows the new active editor by itself: consumers don't have to track tabs. */
    public readonly onDidChangeActiveEditorSelection = this.onDidChangeActiveEditorSelectionEmitter.event;

    public readonly onActiveEditorChanged = this.onActiveEditorChangedEmitter.event;

    public readonly onEditorSaved = this.onEditorSavedEmitter.event;

    /** Fires BEFORE {@link onActiveEditorChanged}: by the time listeners (and focus) run, the active editor's view is in the tree. */
    public readonly onDidChangeEditors = this.onDidChangeEditorsEmitter.event;

    public constructor(
        themeService: ThemeService,
        tokenizationRegistry: TokenizationRegistry,
        tokenStyleResolver: ITokenStyleResolver,
        languageService: ILanguageService,
        configurationService: IConfigurationService,
        undoRedoService: UndoRedoService,
        fileWatcher: IFileWatcher,
        contextMenuController: ContextMenuController,
        logService: ILogService,
        languageConfigurationService: ILanguageConfigurationService = NULL_LANGUAGE_CONFIGURATION_SERVICE,
        // Without a host, closing a dirty tab fails loudly instead of silently losing edits.
        dialogService: DialogService = new DialogService(),
        contributedPaneFactories: readonly IEditorPaneFactory<unknown>[] = [],
        languageFeatures: ILanguageFeaturesService = new LanguageFeaturesService(),
        // The default has no providers: saving fails loudly instead of writing somewhere else.
        files?: IFileService,
        textFileModels?: TextFileModelService,
        paneBuilder?: TextEditorPaneBuilder,
        editorGroups?: IEditorGroupsService,
    ) {
        super();
        this.register(
            toDisposable(() => {
                for (const model of this.untitledWithoutEditor.values()) model.dispose();
                this.untitledWithoutEditor.clear();
            }),
        );
        this.editorGroups = editorGroups ?? this.register(new EditorGroupsService(logService, configurationService));
        const fileService = files ?? this.register(new FileService());
        this.textFileModels =
            textFileModels ??
            this.register(new TextFileModelService(languageService, undoRedoService, fileService, fileWatcher));
        this.paneBuilder =
            paneBuilder ??
            new TextEditorPaneBuilder(
                tokenizationRegistry,
                tokenStyleResolver,
                languageConfigurationService,
                languageFeatures,
                contextMenuController,
            );
        this.themeService = themeService;
        this.languageService = languageService;
        this.configurationService = configurationService;
        this.undoRedoService = undoRedoService;
        // Stryker disable next-line StringLiteral,ObjectLiteral: the channel name and label are captions in the Output selector and don't affect logging behavior
        this.logger = logService.createLogger("workbench.editorGroups", { label: "Editor Groups" });
        this.paneFactories = [createTextEditorPaneFactory(this), ...contributedPaneFactories];
        this.closeHandler = new EditorCloseHandler(dialogService, {
            surfaces: () => [...this.textPanes(), ...this.diffSidePanes()],
        });
        const onSaveHost: IOnSaveParticipantHost = {
            configuration: configurationService,
            languageFeatures,
            paneForUri: (uri) => this.textPanes().find((pane) => pane.uri.toString() === uri) ?? null,
        };
        // The pipeline is assembled at save time from live settings; VS Code order:
        // code actions → format → extensions' will-save.
        const codeActionsOnSave = createCodeActionsOnSaveParticipant(onSaveHost);
        const formatOnSave = createFormatOnSaveParticipant(onSaveHost);
        this.register(
            this.textFileModels.addSaveParticipant((model) =>
                // The filter only saves a pass: without a provider and kinds the participant is a no-op anyway.
                // Stryker disable next-line ConditionalExpression,LogicalOperator: equivalent, see above
                languageFeatures.codeActionProvider.has(model) &&
                // Stryker disable next-line EqualityOperator,ConditionalExpression: a participant with no enabled kinds is a no-op (doesn't call the provider), and the write is async anyway; the filter only saves a pass
                enabledCodeActionKindsOnSave(configurationService, model.languageId).length > 0
                    ? codeActionsOnSave
                    : null,
            ),
        );
        this.register(
            this.textFileModels.addSaveParticipant((model) =>
                // Same for format: without a formatter formatDocument returns null, a no-op.
                // Stryker disable next-line ConditionalExpression,LogicalOperator: equivalent, see above
                hasDocumentFormatter(languageFeatures, model) &&
                configurationService.get("editor.formatOnSave", { overrideIdentifier: model.languageId })
                    ? formatOnSave
                    : null,
            ),
        );
        this.register(this.textFileModels.addSaveParticipant(() => this.saveParticipantValue ?? null));
        this.register(
            this.textFileModels.onDidSaveModel((model) => {
                this.fireEditorsChanged();
                this.fireModelSaved(model);
            }),
        );
        this.register(
            this.editorGroups.onDidChangeEditors(() => {
                this.fireEditorsChanged();
            }),
        );
        this.register(
            this.editorGroups.onDidChangeActivePane((pane) => {
                this.fireActiveEditorChanged(pane);
            }),
        );
        // Diff sides are editing surfaces too: editor.* must reach them as well.
        this.editorConfiguration = this.register(
            new TextEditorConfiguration(this.configurationService, () => [
                ...this.textPanes(),
                ...this.diffSidePanes(),
            ]),
        );
        // A new language means different `"[lang]"` settings sections.
        this.register(
            this.textFileModels.onDidChangeModelLanguage(() => {
                this.editorConfiguration.reapply();
            }),
        );
        // Tabs follow a moved file (upstream `onDidRunFileOperation` → `handleMovedFile`):
        // otherwise the first save would resurrect the file at the old path.
        this.register(
            fileService.onDidRunOperation((event) => {
                // Stryker disable next-line ConditionalExpression: for Move the service always sets `target`; the check only narrows the type
                if (event.operation === FileOperation.Move && event.target !== undefined) {
                    this.handleMovedFile(event.resource, event.target);
                }
                if (event.operation === FileOperation.Delete) this.handleDeletedFile(event.resource);
            }),
        );
        // Deleted externally: with `closeOnFileDelete` clean tabs close (upstream
        // `handleDeletedFile(…, isExternal: true)`), otherwise they stay struck through.
        this.register(
            this.textFileModels.onDidChangeModelOrphaned((model) => {
                if (!model.isOrphaned) return;
                if (!this.configurationService.get(CLOSE_ON_FILE_DELETE_SETTING_KEY)) return;
                this.closeCleanEditors((pane) => pane.fileModel === model);
            }),
        );
        // Preview turned off: pin lingering previews, otherwise the next open would
        // replace the tab (upstream: onDidChangeEditorPartOptions).
        this.register(
            this.configurationService.onDidChangeConfiguration((event) => {
                if (!event.affectsConfiguration(PREVIEW_SETTING_KEY) || this.isPreviewEnabled()) return;
                for (const group of this.editorGroups.groups) {
                    const preview = group.previewPane;
                    if (preview !== null) group.pinPane(preview);
                }
            }),
        );
    }

    /** A tab that can't be replayed (untitled) is not given to the new group, which stays empty. */
    public splitActiveGroup({
        focus = true,
        position,
    }: { focus?: boolean; position?: "before" | "after" } = {}): EditorGroup | null {
        const source = this.editorGroups.activeGroup;
        return this.editorGroups.splitActiveGroup(
            (group, sourcePane) => {
                // A split says "I need this file": pin the source so the next preview
                // doesn't replace half of the split (upstream does the same).
                source.pinPane(sourcePane);
                const recipe = this.describePane(sourcePane);
                if (recipe !== undefined) void recipe.factory.open(recipe.descriptor, { group, focus });
            },
            { focus, position },
        );
    }

    /** A tab that can't be replayed (untitled) is not copied at all. */
    public copyActiveEditorToGroup(direction: "next" | "previous", { focus = true }: { focus?: boolean } = {}): void {
        const source = this.editorGroups.activeGroup;
        const sourcePane = source.activePane;
        // The mutant is equivalent: an empty group has no recipe anyway.
        // Stryker disable next-line ConditionalExpression: equivalent, see above
        if (sourcePane === null) return;
        const recipe = this.describePane(sourcePane);
        if (recipe === undefined) return;
        this.editorGroups.openInNeighborGroup(direction, (target) => {
            source.pinPane(sourcePane);
            void recipe.factory.open(recipe.descriptor, { group: target, focus });
        });
    }

    private describePane(pane: IEditorPane): { factory: IEditorPaneFactory<unknown>; descriptor: unknown } | undefined {
        const recipe = this.recipeOf(pane);
        return recipe?.factory.singleton === true ? undefined : recipe;
    }

    private recipeOf(pane: IEditorPane): { factory: IEditorPaneFactory<unknown>; descriptor: unknown } | undefined {
        for (const factory of this.paneFactories) {
            const descriptor = factory.describe(pane);
            if (descriptor !== undefined) return { factory, descriptor };
        }
        return undefined;
    }

    /** Tab → session entry; `undefined`: the tab doesn't survive a restart. */
    public serializeEditor(pane: IEditorPane): ISerializedEditor | undefined {
        const recipe = this.recipeOf(pane);
        if (recipe === undefined) return undefined;
        const value = recipe.factory.serialize(recipe.descriptor);
        return value === undefined ? undefined : { typeId: recipe.factory.typeId, value };
    }

    /** `undefined`: unknown kind (newer/older build) or not replayable; such entries are silently dropped, as upstream. */
    public deserializeEditor(
        entry: ISerializedEditor,
    ): { factory: IEditorPaneFactory<unknown>; descriptor: unknown } | undefined {
        const factory = this.paneFactories.find((candidate) => candidate.typeId === entry.typeId);
        if (factory === undefined) return undefined;
        const descriptor = factory.deserialize(entry.value);
        return descriptor === undefined ? undefined : { factory, descriptor };
    }

    public openSerializedEditor(entry: ISerializedEditor, target: { group: EditorGroup; focus: boolean }): void {
        const recipe = this.deserializeEditor(entry);
        if (recipe !== undefined) void recipe.factory.open(recipe.descriptor, target);
    }

    /**
     * The tab is replaced, not renamed in place: holders of the resource by uri (extension
     * documents, markers, quick diff) see an honest close-then-open, as upstream.
     * Diff tab sides are left alone: the diff's owner fixes their resources.
     */
    private handleMovedFile(source: Uri, target: Uri): void {
        for (const group of this.editorGroups.groups) {
            let moved = false;
            let focusActive = false;
            for (const [index, pane] of [...group.getPanes()].entries()) {
                if (!(pane instanceof TextEditorPane) || pane.fileModel === null) continue;
                const resource = movedResource(pane.uri, source, target);
                if (resource === null) continue;
                const ref = this.textFileModels.acquire(resource);
                // A file in two groups has one model: a second fill with the same text changes nothing.
                if (pane.fileModel.isModified) ref.model.restoreUnsavedContents(pane.fileModel.getText());
                const editor = this.paneBuilder.build(ref.model, ref);
                this.editorConfiguration.apply(editor);
                applyViewState(editor, {
                    selections: pane.viewState.cloneSelections(),
                    scrollTop: pane.viewState.scrollTop,
                    scrollLeft: pane.viewState.scrollLeft,
                });
                // Only the active tab can hold focus: inactive ones are not mounted.
                if (holdsFocus(pane.view)) focusActive = true;
                group.replacePane(index, editor, { preview: !group.isPinned(pane) });
                moved = true;
            }
            // Replacing fires no events: re-activation provides the repaint and the active change.
            if (moved) group.activateTab(group.activeIndex, { focus: focusActive });
        }
    }

    /**
     * Clean tabs close regardless of `closeOnFileDelete` (upstream `isExternal: false`);
     * a dirty one stays and gets struck through once the watcher makes the model orphaned.
     */
    public handleDeletedFile(resource: Uri): void {
        // A move "onto itself" is non-`null` exactly for a resource equal to `resource` or under it.
        this.closeCleanEditors((pane) => movedResource(pane.uri, resource, resource) !== null);
    }

    /** Diff sides are left alone: the diff's owner fixes their resources. */
    private closeCleanEditors(matches: (pane: TextEditorPane) => boolean): void {
        // Copy the list: a group that becomes empty leaves the strip right inside the loop.
        for (const group of [...this.editorGroups.groups]) {
            const panes = group
                .getPanes()
                .filter((pane): pane is TextEditorPane => pane instanceof TextEditorPane)
                .filter((pane) => pane.fileModel !== null && !pane.isModified && matches(pane));
            // Clean tabs ask for no confirmation, so closing is synchronous.
            void this.closeEditors(group, panes);
        }
    }

    /**
     * Focus inside a detached pane (Output) makes it active: otherwise arrows and Ctrl+F would go
     * to the file behind the pane. Counterpart of `ICodeEditorService.getFocusedCodeEditor()`.
     */
    public getActivePane(): IEditorPane | null {
        const focused = this.focusedDetachedPane();
        if (focused !== null) return focused;
        return this.getActiveTabPane();
    }

    /**
     * Ignores detached panes: needed by those that insert content into the editor area, move focus
     * OUT of the pane, and expose `activeTextEditor` to extensions (focus in the pane doesn't replace it, as in VS Code).
     */
    public getActiveTabPane(): IEditorPane | null {
        return this.editorGroups.activeGroup.activePane;
    }

    private focusedDetachedPane(): TextEditorPane | null {
        if (this.detachedPanes.length === 0) return null;
        return this.detachedPanes.find((pane) => holdsFocus(pane.view)) ?? null;
    }

    /** If the resource is already open in the group, switches to that tab and disposes the given `pane`. */
    public openPane(pane: IEditorPane, { focus = true, group }: { focus?: boolean; group?: EditorGroup } = {}): void {
        if (group !== undefined) {
            this.insertOrRevealPane(group, pane, focus);
            return;
        }
        const target = findGroup(this.editorGroups, pane.uri, undefined);
        this.editorGroups.openInGroup(target, () => {
            this.insertOrRevealPane(target, pane, focus);
        });
    }

    private insertOrRevealPane(group: EditorGroup, pane: IEditorPane, focus: boolean): void {
        const existingIndex = group.findPaneIndex(pane.uri);
        if (existingIndex >= 0) {
            pane.dispose();
            group.activateTab(existingIndex, { focus });
            return;
        }
        group.insertPane(pane);
        group.activateTab(group.editorCount - 1, { focus });
    }

    /** `null` also for a pane of another kind: text consumers silently do nothing on a diff. */
    public getActiveEditor(): TextEditorPane | null {
        const pane = this.getActivePane();
        // Diff sides are real text panes: a silent null would mute the whole tab
        // (the resolved command swallows the key).
        if (pane instanceof DiffEditorPane2) return pane.activeTextPane;
        return pane instanceof TextEditorPane ? pane : null;
    }

    /** Narrower than {@link getActiveEditor} (view state only): the diff moves its cursor with the same code as the editor while staying read-only. */
    public getActiveViewState(): EditorViewState | null {
        return this.getActivePane()?.viewState ?? null;
    }

    public getActiveTabEditor(): TextEditorPane | null {
        const pane = this.getActiveTabPane();
        // The active diff side: Ctrl+S, Save As, and extension editor-options act on it.
        if (pane instanceof DiffEditorPane2) return pane.activeTextPane;
        return pane instanceof TextEditorPane ? pane : null;
    }

    /** Outside the tab bar: not in `getPanes`, session persistence, or shutdown. The owner decides where to insert `pane.view`. */
    public openDetached(uri: Uri, languageId: string): TextEditorPane<SyntheticTextModel> {
        // A synthetic resource is unique by construction, so the model bypasses the registry.
        const model = new SyntheticTextModel(this.languageService, this.undoRedoService, uri, languageId);
        const editor = this.paneBuilder.build(model);
        editor.detached = true;
        // The group wires tab panes; the service wires detached ones itself.
        this.wirePane(editor);
        this.editorConfiguration.apply(editor);
        this.detachedPanes.push(editor);
        return editor;
    }

    /**
     * Read-only tab with caller-supplied content (a file at a revision from `git:`): no watcher, no save,
     * no persistence. A repeat call with the same uri updates the content, since the branch may have moved.
     */
    public openTextSnapshot(
        uri: Uri,
        { text, languageId, label, focus = true }: { text: string; languageId: string; label: string; focus?: boolean },
    ): TextEditorPane {
        const group = findGroup(this.editorGroups, uri, undefined);
        return this.editorGroups.openInGroup(group, () =>
            this.openTextSnapshotIn(group, uri, { text, languageId, label, focus }),
        );
    }

    private openTextSnapshotIn(
        group: EditorGroup,
        uri: Uri,
        { text, languageId, label, focus }: { text: string; languageId: string; label: string; focus: boolean },
    ): TextEditorPane {
        const existingIndex = group.findPaneIndex(uri);
        if (existingIndex >= 0) {
            const existing = this.replaceVirtualContent(group, existingIndex, text);
            /* v8 ignore start -- defensive: only this method opens a snapshot at this uri, so the pane kind is known */
            // Stryker disable next-line ConditionalExpression: unreachable branch for the same reason as for coverage: only this method creates a pane for this resource
            if (existing !== null) {
                /* v8 ignore stop */
                group.activateTab(existingIndex, { focus });
                return existing;
            }
        }

        const editor = this.createVirtualPane(uri, text, { languageId, label });
        group.insertPane(editor);
        group.activateTab(group.editorCount - 1, { focus });
        return editor;
    }

    public getEditors(): readonly TextEditorPane[] {
        return this.textPanes();
    }

    public getTextSurfaces(): readonly TextEditorPane[] {
        return [...this.textPanes(), ...this.diffSidePanes()];
    }

    public getUntitledModelsWithoutEditor(): readonly TextFileModel[] {
        return [...this.untitledWithoutEditor.values()];
    }

    private textPanes(): TextEditorPane[] {
        return this.allPanes().filter((pane): pane is TextEditorPane => pane instanceof TextEditorPane);
    }

    private diffSidePanes(): TextEditorPane[] {
        return this.allPanes().flatMap((pane) => (pane instanceof DiffEditorPane2 ? [...pane.sidePanes()] : []));
    }

    private allPanes(): IEditorPane[] {
        return this.editorGroups.groups.flatMap((group) => [...group.getPanes()]);
    }

    public getOpenFilePaths(): string[] {
        const paths: string[] = [];
        for (const editor of this.textPanes()) {
            if (editor.absoluteFilePath !== null) paths.push(editor.absoluteFilePath);
        }
        return paths;
    }

    /** `path.resolve` right before `Uri.file`: the latter doesn't resolve a relative path but prefixes it with a slash. */
    public openFile(filePath: string, options: IOpenUriOptions = {}): void {
        void this.openUri(Uri.file(path.resolve(filePath)), options);
    }

    /**
     * **The promise never rejects**: callers drop it into `void`, and an unhandled rejection
     * kills the editor (F12 into a `jdt:` resource used to take it down entirely); failures go to the log and
     * {@link onDidFailOpen}. Only a non-disk resource opened for the first time is async: a file from disk and
     * an already open tab open before the first `await`.
     */
    public openUri(uri: Uri, options: IOpenUriOptions = {}): Promise<void> {
        if (uri.scheme === "file" || this.isOpenInTargetGroup(uri, options.group)) {
            this.openResolvedUri(uri, null, options);
            return Promise.resolve();
        }
        const untitled = this.untitledWithoutEditor.get(uri.toString());
        if (untitled !== undefined) {
            this.openUntitledWithoutEditor(untitled, options);
            return Promise.resolve();
        }
        return this.openVirtualUri(uri, options);
    }

    /** `content`: `null` for a file from disk or an already open tab, a string for a fresh non-disk resource. */
    private openResolvedUri(
        uri: Uri,
        content: string | null,
        { focus = true, group: where, viewState, preview = false }: IOpenUriOptions,
    ): void {
        // Identity is the whole resource within the group, not the basename.
        const group = findGroup(this.editorGroups, uri, where);
        this.editorGroups.openInGroup(group, () => {
            this.openInResolvedGroup(group, uri, content, { focus, viewState, preview });
        });
    }

    private openInResolvedGroup(
        group: EditorGroup,
        uri: Uri,
        content: string | null,
        {
            focus,
            viewState,
            preview,
        }: { focus: boolean; viewState: ITextEditorViewState | undefined; preview: boolean },
    ): void {
        // Preview only on the caller's request (the Explorer tree) and with the setting on,
        // as upstream with enablePreviewFrom* turned off.
        const asPreview = preview && this.isPreviewEnabled();
        const existingIndex = group.findPaneIndex(uri);
        if (existingIndex >= 0) {
            // A repeat non-preview open pins the tab (upstream: doOpenEditor).
            if (!asPreview) group.pinPane(group.getPanes()[existingIndex]);
            group.activateTab(existingIndex, { focus });
        } else {
            // The tab owns a reference to the model, not the model itself.
            let editor: TextEditorPane;
            if (content !== null) {
                editor = this.createVirtualPane(uri, content);
            } else {
                const ref = this.textFileModels.acquire(uri);
                editor = this.paneBuilder.build(
                    ref.model,
                    ref,
                    this.editorConfiguration.indentConfigurationFor(ref.model.languageId),
                );
                this.editorConfiguration.apply(editor);
            }
            if (viewState !== undefined) applyViewState(editor, viewState);
            // A new preview takes the previous one's slot, otherwise tab order and focus would shift.
            const replacedIndex = asPreview ? this.previewIndexToReplace(group) : -1;
            if (replacedIndex >= 0) {
                group.replacePane(replacedIndex, editor, { preview: true });
                group.activateTab(replacedIndex, { focus });
            } else {
                group.insertPane(editor, { preview: asPreview });
                group.activateTab(group.editorCount - 1, { focus });
            }
        }
    }

    private isPreviewEnabled(): boolean {
        // No fallback of our own: the schema guarantees the default; a local one would drift from it.
        return this.configurationService.get(PREVIEW_SETTING_KEY);
    }

    /** A dirty preview is pinned rather than replaced: otherwise unsaved edits would be lost. */
    private previewIndexToReplace(group: EditorGroup): number {
        const preview = group.previewPane;
        if (preview === null) return -1;
        if (preview.isModified) {
            group.pinPane(preview);
            return -1;
        }
        return group.getPanes().indexOf(preview);
    }

    /** No side effects, unlike {@link openResolvedUri}: doesn't activate the group or create a neighbor. */
    private isOpenInTargetGroup(uri: Uri, where?: "beside" | EditorGroup): boolean {
        const group = peekGroup(this.editorGroups, uri, where);
        return group !== undefined && group.findPaneIndex(uri) >= 0;
    }

    /**
     * The scheme may have no provider, or it may refuse or break; in every case the user
     * must see why nothing opened ({@link onDidFailOpen}).
     */
    private async openVirtualUri(uri: Uri, options: IOpenUriOptions): Promise<void> {
        const source = this.virtualDocumentSource;
        if (!source.canProvide(uri.scheme)) {
            this.reportOpenFailed(uri, `no content provider is registered for the "${uri.scheme}:" scheme`);
            return;
        }
        let content: string | null;
        try {
            content = await source.provide(uri);
        } catch (error) {
            this.reportOpenFailed(uri, describeError(error));
            return;
        }
        if (content === null) {
            this.reportOpenFailed(uri, `the "${uri.scheme}:" content provider returned no content`);
            return;
        }
        this.openResolvedUri(uri, content, options);
    }

    /** `output:` and snapshot diff sides are not restorable: the tab owner writes their content, the resource doesn't address it. */
    public canRestore(uri: Uri): boolean {
        if (uri.scheme === "file" || uri.scheme === "untitled") return true;
        return this.virtualDocumentSource.canProvide(uri.scheme);
    }

    /** A resource that isn't open gets no tab: the user didn't ask for one. A provider failure only goes to the log: the refresh is in the background. */
    public refreshVirtualDocument(uri: Uri): void {
        const key = uri.toString();
        // A non-disk resource's tab is text and synthetic by construction: the checks only narrow the type.
        // Stryker disable next-line MethodExpression: equivalent, see above
        const textPanes = this.allPanes().filter(isTextEditorPane);
        const targets = textPanes.flatMap((pane) =>
            pane.uri.toString() === key &&
            // Stryker disable next-line ConditionalExpression: equivalent, see above
            pane.model instanceof SyntheticTextModel
                ? [pane.model]
                : [],
        );
        if (targets.length === 0) return;
        // `.catch` at the tail, not as the second `then` argument: it also covers a failure while filling in the text.
        void this.virtualDocumentSource
            .provide(uri)
            .then((content) => {
                if (content === null) return;
                for (const model of targets) model.replaceContent(content);
            })
            .catch((error: unknown) => {
                this.logger.error(`cannot refresh ${uri.toString()}: ${describeError(error)}`);
            });
    }

    /** Language comes from the resource "path": for `jdt://contents/…/StringUtils.java` it is accurate. */
    private createVirtualPane(
        uri: Uri,
        content: string,
        overrides: { languageId?: string; label?: string } = {},
    ): TextEditorPane {
        const languageId = overrides.languageId ?? this.languageService.getLanguageIdForResource(uri.path);
        const model = new SyntheticTextModel(
            this.languageService,
            this.undoRedoService,
            uri,
            languageId ?? "plaintext",
        );
        model.replaceContent(content);
        const editor = this.paneBuilder.build(model);
        editor.labelOverride = overrides.label ?? path.basename(uri.path);
        this.editorConfiguration.apply(editor);
        editor.readOnly = true;
        return editor;
    }

    /** `null`: the pane at this position is of another kind. */
    private replaceVirtualContent(group: EditorGroup, index: number, content: string): TextEditorPane | null {
        const pane = group.getPane(index);
        /* v8 ignore start -- defensive: only createVirtualPane creates a tab for this resource */
        // Stryker disable next-line ConditionalExpression,LogicalOperator: unreachable branch for the same reason as for coverage
        if (!(pane instanceof TextEditorPane) || !(pane.model instanceof SyntheticTextModel)) return null;
        /* v8 ignore stop */
        pane.model.replaceContent(content);
        return pane;
    }

    private reportOpenFailed(uri: Uri, reason: string): void {
        this.logger.error(`cannot open ${uri.toString()}: ${reason}`);
        this.onDidFailOpenEmitter.fire({ uri, reason });
    }

    public newUntitled({ focus = true }: { focus?: boolean } = {}): void {
        const model = this.textFileModels.createUntitledModel();
        const editor = this.paneBuilder.build(model);
        this.editorConfiguration.apply(editor);
        const group = findGroup(this.editorGroups, undefined, undefined);
        this.editorGroups.openInGroup(group, () => {
            group.insertPane(editor);
            group.activateTab(group.editorCount - 1, { focus });
        });
    }

    /**
     * `workspace.openTextDocument({ content })` (upstream `$tryCreateDocument`): the document is open for
     * extensions right away; `showTextDocument` creates the tab via {@link openUri}. Non-empty text makes a dirty buffer.
     */
    public createUntitled({ content, languageId, encoding }: IUntitledOptions = {}): Uri {
        const model = this.textFileModels.createUntitledModel();
        if (languageId !== undefined) model.setLanguage(languageId);
        // Stryker disable next-line ConditionalExpression: equivalent: setEncoding skips an unknown (or missing) encoding anyway
        if (encoding !== undefined) model.setEncoding(encoding);
        // Empty text is not an edit: the buffer stays clean (upstream `!!initialValue`).
        if (content !== undefined && content !== "") model.restoreUnsavedContents(content);
        this.untitledWithoutEditor.set(model.uri.toString(), model);
        this.fireEditorsChanged();
        return model.uri;
    }

    /** Model ownership passes to the tab. */
    private openUntitledWithoutEditor(model: TextFileModel, { focus = true, group: where }: IOpenUriOptions): void {
        this.untitledWithoutEditor.delete(model.uri.toString());
        const editor = this.paneBuilder.build(model);
        this.editorConfiguration.apply(editor);
        const group = findGroup(this.editorGroups, model.uri, where);
        this.editorGroups.openInGroup(group, () => {
            group.insertPane(editor);
            group.activateTab(group.editorCount - 1, { focus });
        });
    }

    /** Only for panes outside the tab bar: the group wires tab panes itself in `insertPane`. */
    private wirePane(pane: IEditorPane): void {
        this.register(pane);
        this.register(
            pane.onDidChangeState(() => {
                this.fireEditorsChanged();
            }),
        );
    }

    public async activate(): Promise<void> {
        // Nothing to activate yet: async editor initialization (LSP etc.) is
        // a future seam of the service layer.
    }

    /** Focuses the tab (not the pane), of any kind: a diff gets input too. */
    public focusEditor(): void {
        this.getActiveTabPane()?.focusEditor();
    }

    /**
     * `isStillDirty` catches tabs closed while the user was answering earlier dialogs. Save on exit
     * overwrites the file even with external changes: the user's choice must not be lost.
     */
    public collectDirty(): readonly IShutdownDirtyItem[] {
        return this.dirtyEditors().map((editor) => ({
            name: this.displayName(editor),
            isStillDirty: () =>
                [...this.textPanes(), ...this.diffSidePanes()].some((pane) => pane.model === editor.model),
            save: async () => (await editor.save({ overwrite: true })) === "saved",
        }));
    }

    /**
     * Upstream `saveAll`. An untitled buffer is skipped (we don't open Save As in the middle of a task run),
     * a file changed on disk is not overwritten. With `includeUntitled` upstream asks for a path in a dialog;
     * we have none, so a remaining untitled buffer yields an honest `false`.
     */
    public async saveAll(options?: { includeUntitled?: boolean }): Promise<boolean> {
        let success = true;
        for (const editor of this.dirtyEditors()) {
            const outcome = await this.trySave(editor);
            if (outcome === "saved" || (outcome === "no-file" && options?.includeUntitled !== true)) continue;
            success = false;
        }
        return success;
    }

    /** Upstream `$save` without Save As: a clean buffer is written too (`force`). */
    public async save(resource: Uri): Promise<Uri | undefined> {
        const key = resource.toString();
        const editor = this.getTextSurfaces().find((pane) => pane.uri.toString() === key);
        if (editor === undefined) return undefined;
        return (await this.trySave(editor)) === "saved" ? editor.uri : undefined;
    }

    private async trySave(editor: TextEditorPane): Promise<SaveOutcome | undefined> {
        try {
            return await editor.save();
        } catch (error) {
            this.logger.error(`cannot save ${editor.uri.toString()}: ${describeError(error)}`);
            return undefined;
        }
    }

    /**
     * One per model. Diff sides come after tabs: a tab has a nicer label, and a diff adds
     * only its own buffers (untitled sides, a file without a regular tab).
     */
    private dirtyEditors(): TextEditorPane[] {
        const seenModels = new Set<BaseTextEditorModel>();
        const editors: TextEditorPane[] = [];
        for (const editor of [...this.textPanes(), ...this.diffSidePanes()]) {
            if (!editor.isModified || seenModels.has(editor.model)) continue;
            seenModels.add(editor.model);
            editors.push(editor);
        }
        return editors;
    }

    public needsCloseConfirm(pane: IEditorPane): boolean {
        return this.closeHandler.needsCloseConfirm(pane);
    }

    public dirtyExclusiveDiffSides(pane: DiffEditorPane2): TextEditorPane[] {
        return this.closeHandler.dirtyExclusiveDiffSides(pane);
    }

    /** `false`: the user cancelled or Save failed. A position outside the strip means nothing to close, `true`. */
    public closeEditor(group: EditorGroup, target: IEditorPane | number): Promise<boolean> {
        const pane = typeof target === "number" ? group.getPane(target) : target;
        if (pane === null) return Promise.resolve(true);
        return this.closeEditors(group, [pane]);
    }

    /** `panes` order is the dialog order; the first veto stops the series. */
    public closeEditors(group: EditorGroup, panes: readonly IEditorPane[]): Promise<boolean> {
        return this.closeHandler.confirmAndClose(group, panes);
    }

    /** From the tail, like Ctrl+K W: dialogs go right to left, Cancel stops the series. */
    public closeAllEditors(group: EditorGroup): Promise<boolean> {
        return this.closeEditors(group, [...group.getPanes()].reverse());
    }

    public displayName(editor: IEditorPane): string {
        return editor.label;
    }

    /** The extension comes from the buffer's current language: change the language and the suggestion follows. */
    public suggestedSaveName(editor: TextEditorPane): string {
        const name = this.displayName(editor);
        const extension = this.languageService.getExtensionForLanguage(editor.languageId);
        return extension === undefined ? name : `${name}${extension}`;
    }

    private fireEditorsChanged(): void {
        this.onDidChangeEditorsEmitter.fire();
    }

    /** Only a text pane is exposed: for text consumers a diff means "no active editor". */
    private fireActiveEditorChanged(pane: IEditorPane | null): void {
        const editor = pane instanceof TextEditorPane ? pane : null;
        this.rebindActiveSelectionForwarding(editor);
        this.onActiveEditorChangedEmitter.fire(editor);
    }

    /** Doesn't notify {@link onDidChangeActiveEditorSelection} listeners: the change is visible via {@link onActiveEditorChanged}. */
    private rebindActiveSelectionForwarding(editor: TextEditorPane | null): void {
        this.activeSelectionSubscription?.dispose();
        this.activeSelectionSubscription = undefined;
        if (editor === null) return;
        this.activeSelectionSubscription = editor.onDidChangeSelection(() => {
            this.onDidChangeActiveEditorSelectionEmitter.fire(editor);
        });
    }

    private fireModelSaved(model: TextFileModel): void {
        const meta: IEditorSavedMeta = { uri: model.uri.toString(), languageId: model.languageId };
        this.onEditorSavedEmitter.fire(meta);
    }
}
