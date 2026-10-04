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

/**
 * Участник пайплайна сохранения: по модели решает, участвует ли он в ЭТОМ
 * save (`null` — нет). Спрашивается в момент сохранения, а не при регистрации:
 * настройки и провайдеры живые.
 */
export type SaveParticipantProvider = (model: TextFileModel) => SaveParticipant | null;

/**
 * Модели текстовых файлов — аналог upstream `ITextFileService.files` /
 * `.untitled` поверх `ITextModelService`: реестр файловых моделей (одна на
 * ресурс, ref-count), безымянные буферы со сквозной нумерацией, модельная
 * обвязка (watcher, пайплайн save-участников) и агрегатное событие
 * сохранения. Вкладок и вью не знает — их строит `EditorService`.
 *
 * Синтетические буферы (Output, `jdt:`, снимки) сюда не входят: у них нет ни
 * файла, ни сохранения, и владеет ими тот, кто их создал.
 */
export class TextFileModelService extends Disposable {
    public static dependencies = [
        LanguageServiceDIToken,
        UndoRedoServiceDIToken,
        IFileServiceDIToken,
        IFileWatcherDIToken,
    ] as const;

    private readonly registry = new TextFileModelRegistry((uri) => this.createFileModel(uri));
    /**
     * Монотонный счётчик номеров безымянных буферов (`Untitled-1`, `Untitled-2`, …).
     * Не переиспользуется при закрытии вкладок — как в VS Code, номер стабилен за
     * буфером всю его жизнь.
     */
    private untitledCounter = 0;
    private readonly saveParticipantProviders: SaveParticipantProvider[] = [];
    /**
     * Пайплайн save-участников — один на все модели сервиса; состав собирается
     * в момент сохранения ({@link addSaveParticipant}).
     */
    private readonly saveParticipant = new TextFileSaveParticipant((model) =>
        // Мусор вместо пропуска пайплайн и так проглотил бы как сбойного
        // участника — мутант ненаблюдаем.
        // Stryker disable next-line ArrayDeclaration: эквивалентен — см. выше
        this.saveParticipantProviders.flatMap((provider) => provider(model) ?? []),
    );
    private readonly onDidSaveModelEmitter = this.register(new Emitter<TextFileModel>());
    private readonly onDidChangeModelLanguageEmitter = this.register(new Emitter<TextFileModel>());

    /**
     * Сохранение любой модели сервиса — после того, как реестр перепривязал
     * ключ (saveAs мог сменить ресурс).
     */
    public readonly onDidSaveModel = this.onDidSaveModelEmitter.event;

    /** Смена языка документа любой модели сервиса (настройки `"[lang]"` читаются заново). */
    public readonly onDidChangeModelLanguage = this.onDidChangeModelLanguageEmitter.event;

    public constructor(
        private readonly languageService: ILanguageService,
        private readonly undoRedoService: UndoRedoService,
        private readonly files: IFileService,
        private readonly fileWatcher: IFileWatcher,
    ) {
        super();
    }

    /**
     * Добавляет участника в пайплайн сохранения. Порядок регистрации — порядок
     * исполнения: правки каждого ложатся в буфер до следующего и до записи.
     */
    public addSaveParticipant(provider: SaveParticipantProvider): IDisposable {
        this.saveParticipantProviders.push(provider);
        return {
            dispose: () => {
                const index = this.saveParticipantProviders.indexOf(provider);
                if (index >= 0) this.saveParticipantProviders.splice(index, 1);
            },
        };
    }

    /**
     * Ссылка на общую модель файла: тот же документ, что у всех вкладок и
     * сторон диффа этого файла, поэтому несохранённые правки видны везде, а
     * undo общий. Владелец обязан освободить ссылку.
     */
    public acquire(uri: Uri): ITextFileModelReference {
        return this.registry.acquire(uri);
    }

    /** Открытая модель ресурса, если есть; без создания и без изменения ref-count. */
    public get(uri: Uri): TextFileModel | null {
        return this.registry.get(uri);
    }

    /**
     * Безымянный буфер мимо реестра (уникален по построению), номер — из
     * общего счётчика: `Untitled-N` стабилен, Save As работает штатно.
     * Владение — у вызывающего (вкладка или панель диффа).
     */
    public createUntitledModel(): TextFileModel {
        const model = new TextFileModel(this.languageService, this.undoRedoService, this.files);
        this.wireModel(model);
        model.setUntitled(++this.untitledCounter);
        return model;
    }

    /**
     * Фабрика реестра моделей: модель файла + модельная обвязка + загрузка.
     * Наблюдатель ставится до openFile ({@link wireModel}), чтобы слежение
     * началось с первой загрузки.
     */
    private createFileModel(uri: Uri): TextFileModel {
        const model = new TextFileModel(this.languageService, this.undoRedoService, this.files);
        this.wireModel(model);
        model.openFile(uri);
        return model;
    }

    /**
     * Модельная обвязка — ставится один раз на документ, а не на вкладку:
     * watcher, save-участник и событие сохранения принадлежат файлу, сколько бы
     * вью его ни показывало.
     */
    private wireModel(model: TextFileModel): void {
        model.fileWatcher = this.fileWatcher;
        model.saveParticipant = this.saveParticipant;
        // Подписка ставится первой — раньше вкладок: реестр должен перепривязать
        // ключ до того, как вкладки перерисуют имя после saveAs. Живёт, сколько
        // модель: эмиттер модели снимает её вместе с собой.
        model.onDidSaveDocument(() => {
            this.registry.handleUriChanged(model);
            this.onDidSaveModelEmitter.fire(model);
        });
        model.onDidChangeLanguage(() => {
            this.onDidChangeModelLanguageEmitter.fire(model);
        });
    }
}
