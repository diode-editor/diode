import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { LanguageServiceDIToken } from "../../../../editor/common/languages/iLanguageService.ts";
import {
    DEFAULT_LARGE_FILE_OPTIONS,
    type ILargeFileOptions,
} from "../../../../editor/common/model/largeFileOptions.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { type IFileService, IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import type { IFileWatcher } from "../../../../platform/files/common/iFileWatcher.ts";
import { IFileWatcherDIToken } from "../../../../platform/files/common/iFileWatcherDIToken.ts";
import {
    type IRandomAccessFileOpener,
    IRandomAccessFileOpenerDIToken,
} from "../../../../platform/files/common/iRandomAccessFile.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { UndoRedoService, UndoRedoServiceDIToken } from "../../../../platform/undoRedo/common/undoRedoService.ts";

import type { SaveParticipant } from "./iSaveParticipant.ts";
import { TextFileModel } from "./textFileModel.ts";
import { type ITextFileModelReference, TextFileModelRegistry } from "./textFileModelRegistry.ts";
import { TextFileSaveParticipant } from "./textFileSaveParticipant.ts";

export const TextFileModelServiceDIToken = token<TextFileModelService>("TextFileModelService");

/** `null`: does not take part in THIS save. Queried on each save, since settings and providers are live. */
export type SaveParticipantProvider = (model: TextFileModel) => SaveParticipant | null;

/**
 * Upstream `ModelService.getCreationOptions`: read at the model's first load, per language
 * (`"[log]": { "editor.largeFileOptimizations": false }` works). Without a configuration service — the
 * upstream constants. No fallback of our own: the schema guarantees the defaults.
 */
export function largeFileOptionsFromConfiguration(
    configuration: IConfigurationService | undefined,
): (languageId: string) => ILargeFileOptions {
    if (configuration === undefined) return () => DEFAULT_LARGE_FILE_OPTIONS;
    return (languageId) => {
        const overrides = { overrideIdentifier: languageId };
        return {
            largeFileOptimizations: configuration.get("editor.largeFileOptimizations", overrides),
            sizeThresholdMb: configuration.get("editor.largeFileSizeThreshold", overrides),
            lineCountThreshold: configuration.get("editor.largeFileLineCountThreshold", overrides),
        };
    };
}

/**
 * Counterpart of `ITextFileService.files`/`.untitled`. Knows nothing of tabs and views, which
 * `EditorService` builds; synthetic buffers (Output, `jdt:`, snapshots) are not included.
 */
export class TextFileModelService extends Disposable {
    public static dependencies = [
        LanguageServiceDIToken,
        UndoRedoServiceDIToken,
        IFileServiceDIToken,
        IFileWatcherDIToken,
        IConfigurationServiceDIToken,
        IRandomAccessFileOpenerDIToken,
    ] as const;

    private readonly registry = new TextFileModelRegistry((uri) => this.createFileModel(uri));
    /** Not reused when tabs close: as in VS Code, the number sticks to its buffer. */
    private untitledCounter = 0;
    private readonly saveParticipantProviders: SaveParticipantProvider[] = [];
    private readonly saveParticipant = new TextFileSaveParticipant((model) =>
        // The pipeline would swallow garbage instead of a skip as a failing participant
        // anyway, so the mutant is unobservable.
        // Stryker disable next-line ArrayDeclaration: equivalent, see above
        this.saveParticipantProviders.flatMap((provider) => provider(model) ?? []),
    );
    private readonly onDidSaveModelEmitter = this.register(new Emitter<TextFileModel>());
    private readonly onDidChangeModelLanguageEmitter = this.register(new Emitter<TextFileModel>());
    private readonly onDidChangeModelOrphanedEmitter = this.register(new Emitter<TextFileModel>());

    /** Fires after the registry rebinds the key (saveAs may have changed the resource). */
    public readonly onDidSaveModel = this.onDidSaveModelEmitter.event;

    /** `"[lang]"` settings are re-read. */
    public readonly onDidChangeModelLanguage = this.onDidChangeModelLanguageEmitter.event;

    /** Upstream `ITextFileEditorModelManager.onDidChangeOrphaned`. */
    public readonly onDidChangeModelOrphaned = this.onDidChangeModelOrphanedEmitter.event;

    private readonly largeFileOptions: (languageId: string) => ILargeFileOptions;

    public constructor(
        private readonly languageService: ILanguageService,
        private readonly undoRedoService: UndoRedoService,
        private readonly files: IFileService,
        private readonly fileWatcher: IFileWatcher,
        configuration?: IConfigurationService,
        /** Without it a large file is read into memory (docs/arch/Editor.md, the document on disk). */
        private readonly randomAccessFiles: IRandomAccessFileOpener | null = null,
    ) {
        super();
        this.largeFileOptions = largeFileOptionsFromConfiguration(configuration);
    }

    /** Registration order is execution order. */
    public addSaveParticipant(provider: SaveParticipantProvider): IDisposable {
        this.saveParticipantProviders.push(provider);
        return {
            dispose: () => {
                const index = this.saveParticipantProviders.indexOf(provider);
                if (index >= 0) this.saveParticipantProviders.splice(index, 1);
            },
        };
    }

    /** The same document for all tabs and diff sides of a file. The owner must release the reference. */
    public acquire(uri: Uri): ITextFileModelReference {
        return this.registry.acquire(uri);
    }

    /** The first open reads the resource through the file service (provider reads are async). */
    public async acquireProvided(uri: Uri): Promise<ITextFileModelReference> {
        if (this.registry.get(uri) === null) {
            const { value } = await this.files.readFile(uri);
            // Someone else may have opened the model during the read; then take it, not what was read.
            return this.registry.acquire(uri, () => this.createProvidedModel(uri, value));
        }
        return this.registry.acquire(uri);
    }

    public get(uri: Uri): TextFileModel | null {
        return this.registry.get(uri);
    }

    /** Bypasses the registry (unique by construction). Owned by the caller (a tab or a diff pane). */
    public createUntitledModel(): TextFileModel {
        const model = new TextFileModel(this.languageService, this.undoRedoService, this.files);
        this.wireModel(model);
        model.setUntitled(++this.untitledCounter);
        return model;
    }

    /** The watcher is set before openFile ({@link wireModel}) so watching starts from the first load. */
    private createFileModel(uri: Uri): TextFileModel {
        const model = new TextFileModel(this.languageService, this.undoRedoService, this.files);
        this.wireModel(model);
        model.openFile(uri);
        return model;
    }

    private createProvidedModel(uri: Uri, bytes: Uint8Array): TextFileModel {
        const model = new TextFileModel(this.languageService, this.undoRedoService, this.files);
        this.wireModel(model);
        model.openProvided(uri, bytes);
        return model;
    }

    /** Once per document, not per tab: the wiring belongs to the file. */
    private wireModel(model: TextFileModel): void {
        model.fileWatcher = this.fileWatcher;
        model.saveParticipant = this.saveParticipant;
        model.largeFileOptions = this.largeFileOptions;
        model.randomAccessFiles = this.randomAccessFiles;
        // Subscribes first, before tabs: the registry must rebind the key before tabs
        // repaint the name after saveAs. The model's emitter disposes it along with itself.
        model.onDidSaveDocument(() => {
            this.registry.handleUriChanged(model);
            this.onDidSaveModelEmitter.fire(model);
        });
        model.onDidChangeLanguage(() => {
            this.onDidChangeModelLanguageEmitter.fire(model);
        });
        model.onDidChangeOrphaned(() => {
            this.onDidChangeModelOrphanedEmitter.fire(model);
        });
    }
}
