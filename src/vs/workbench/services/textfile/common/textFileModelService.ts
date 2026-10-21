import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { LanguageServiceDIToken } from "../../../../editor/common/languages/iLanguageService.ts";
import { type IFileService, IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import type { IFileWatcher } from "../../../../platform/files/common/iFileWatcher.ts";
import { IFileWatcherDIToken } from "../../../../platform/files/common/iFileWatcherDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { UndoRedoService, UndoRedoServiceDIToken } from "../../../../platform/undoRedo/common/undoRedoService.ts";

import type { SaveParticipant } from "./iSaveParticipant.ts";
import { TextFileModel } from "./textFileModel.ts";
import { type ITextFileModelReference, TextFileModelRegistry } from "./textFileModelRegistry.ts";
import { TextFileSaveParticipant } from "./textFileSaveParticipant.ts";

export const TextFileModelServiceDIToken = token<TextFileModelService>("TextFileModelService");

/** `null` — не участвует в ЭТОМ save. Спрашивается при сохранении: настройки и провайдеры живые. */
export type SaveParticipantProvider = (model: TextFileModel) => SaveParticipant | null;

/**
 * Аналог `ITextFileService.files`/`.untitled`. Вкладок и вью не знает — их строит
 * `EditorService`; синтетические буферы (Output, `jdt:`, снимки) сюда не входят.
 */
export class TextFileModelService extends Disposable {
    public static dependencies = [
        LanguageServiceDIToken,
        UndoRedoServiceDIToken,
        IFileServiceDIToken,
        IFileWatcherDIToken,
    ] as const;

    private readonly registry = new TextFileModelRegistry((uri) => this.createFileModel(uri));
    /** Не переиспользуется при закрытии вкладок — как в VS Code, номер стабилен за буфером. */
    private untitledCounter = 0;
    private readonly saveParticipantProviders: SaveParticipantProvider[] = [];
    private readonly saveParticipant = new TextFileSaveParticipant((model) =>
        // Мусор вместо пропуска пайплайн и так проглотил бы как сбойного
        // участника — мутант ненаблюдаем.
        // Stryker disable next-line ArrayDeclaration: эквивалентен — см. выше
        this.saveParticipantProviders.flatMap((provider) => provider(model) ?? []),
    );
    private readonly onDidSaveModelEmitter = this.register(new Emitter<TextFileModel>());
    private readonly onDidChangeModelLanguageEmitter = this.register(new Emitter<TextFileModel>());
    private readonly onDidChangeModelOrphanedEmitter = this.register(new Emitter<TextFileModel>());

    /** После того, как реестр перепривязал ключ (saveAs мог сменить ресурс). */
    public readonly onDidSaveModel = this.onDidSaveModelEmitter.event;

    /** Настройки `"[lang]"` читаются заново. */
    public readonly onDidChangeModelLanguage = this.onDidChangeModelLanguageEmitter.event;

    /** `ITextFileEditorModelManager.onDidChangeOrphaned` эталона. */
    public readonly onDidChangeModelOrphaned = this.onDidChangeModelOrphanedEmitter.event;

    public constructor(
        private readonly languageService: ILanguageService,
        private readonly undoRedoService: UndoRedoService,
        private readonly files: IFileService,
        private readonly fileWatcher: IFileWatcher,
    ) {
        super();
    }

    /** Порядок регистрации — порядок исполнения. */
    public addSaveParticipant(provider: SaveParticipantProvider): IDisposable {
        this.saveParticipantProviders.push(provider);
        return {
            dispose: () => {
                const index = this.saveParticipantProviders.indexOf(provider);
                if (index >= 0) this.saveParticipantProviders.splice(index, 1);
            },
        };
    }

    /** Тот же документ у всех вкладок и сторон диффа файла. Владелец обязан освободить ссылку. */
    public acquire(uri: Uri): ITextFileModelReference {
        return this.registry.acquire(uri);
    }

    /** Первое открытие читает ресурс файловым сервисом (чтение провайдера асинхронное). */
    public async acquireProvided(uri: Uri): Promise<ITextFileModelReference> {
        if (this.registry.get(uri) === null) {
            const { value } = await this.files.readFile(uri);
            // Пока читали, модель мог открыть другой — тогда берём её, а не читанное.
            return this.registry.acquire(uri, () => this.createProvidedModel(uri, value));
        }
        return this.registry.acquire(uri);
    }

    public get(uri: Uri): TextFileModel | null {
        return this.registry.get(uri);
    }

    /** Мимо реестра (уникален по построению). Владение — у вызывающего (вкладка или панель диффа). */
    public createUntitledModel(): TextFileModel {
        const model = new TextFileModel(this.languageService, this.undoRedoService, this.files);
        this.wireModel(model);
        model.setUntitled(++this.untitledCounter);
        return model;
    }

    /** Наблюдатель ставится до openFile ({@link wireModel}), чтобы слежение началось с первой загрузки. */
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

    /** Один раз на документ, а не на вкладку: обвязка принадлежит файлу. */
    private wireModel(model: TextFileModel): void {
        model.fileWatcher = this.fileWatcher;
        model.saveParticipant = this.saveParticipant;
        // Подписка первой — раньше вкладок: реестр должен перепривязать ключ до того, как
        // вкладки перерисуют имя после saveAs. Эмиттер модели снимает её вместе с собой.
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
