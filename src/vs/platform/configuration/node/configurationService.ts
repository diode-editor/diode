import * as fs from "node:fs";
import * as path from "node:path";

import { applyEdits, modify, parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser";

import { Emitter } from "../../../base/common/event.ts";
import { Disposable, MutableDisposable } from "../../../base/common/lifecycle.ts";
import type { IUserDataPaths } from "../../environment/node/userDataPaths.ts";
import type { IFileWatcher } from "../../files/common/iFileWatcher.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { ConfigurationModel } from "../common/configurationModel.ts";
import type {
    ConfigurationRegistry,
    ConfigurationScope,
    IConfigurationPropertySchema,
} from "../common/configurationRegistry.ts";
import { ConfigurationSnapshot } from "../common/configurationSnapshot.ts";
import { filterWorkspaceSettings } from "../common/configurationValidation.ts";
import type {
    ConfigurationTarget,
    IConfigurationChangeEvent,
    IConfigurationData,
    IConfigurationInspectResult,
    IConfigurationKeys,
    IConfigurationOverrides,
    IConfigurationService,
} from "../common/iConfigurationService.ts";
import {
    NO_WORKSPACE_OPENED_ERROR,
    workspaceScopeWriteError,
    workspaceSettingsPath,
} from "../common/workspaceSettings.ts";

/**
 * Реализация {@link IConfigurationService}.
 *
 * Слои (в порядке возрастания приоритета):
 *   1. defaults — из `ConfigurationRegistry` (узлы `CONFIGURATION_CONTRIBUTIONS`);
 *   2. user — `User/settings.json` (default-профиль);
 *   3. profile — `User/profiles/<name>/settings.json` (только если активный
 *      профиль не default, иначе пусто);
 *   4. workspace — `<папка>/.diode/settings.json` открытой папки (у эталона —
 *      `.vscode/settings.json`, см. `workspaceSettings.ts`) без ключей, чей
 *      `scope` воркспейсу не положен. Папку сервису сообщают
 *      {@link ConfigurationService.setWorkspaceFolders}: на старте и при Open
 *      Folder. Без папки слой пуст.
 *
 * Live-reload: если в конструктор передан {@link IFileWatcher} и пути к
 * settings.json, сервис следит за файлом(-ами) и на изменение перечитывает
 * соответствующий слой, пересобирает merged и эмитит `onDidChangeConfiguration`
 * с диффом затронутых ключей. Правки через {@link updateValue} эмитят то же
 * событие. Дифф гарантирует, что пустое изменение (напр. повторный reload после
 * собственной записи) события не порождает.
 *
 * Битые JSONC-файлы логируются через переданный `ILogger` и трактуются как
 * пустой слой — bootstrap не должен падать из-за невалидного settings.json.
 */
export class ConfigurationService extends Disposable implements IConfigurationService {
    private readonly defaultsLayer: ConfigurationModel;
    private userLayer: ConfigurationModel;
    private profileLayer: ConfigurationModel;
    private workspaceLayer = ConfigurationModel.EMPTY;
    private snapshot: ConfigurationSnapshot;
    /** settings.json воркспейса открытой папки; `undefined` — папка не открыта. */
    private workspaceSettingsFile: string | undefined;
    /** Watch на settings.json воркспейса — меняется вместе с папкой. */
    private readonly workspaceWatch = this.register(new MutableDisposable());
    private readonly fileWatcher: IFileWatcher | undefined;
    /**
     * Поколение папки воркспейса: загрузка слоя, закончившаяся после следующей
     * смены папки, результат не применяет.
     */
    private workspaceGeneration = 0;
    /** Хвост очереди записей: read-modify-write одного файла не должны перекрываться. */
    private writeQueue: Promise<void> = Promise.resolve();
    /**
     * settings.json активного профиля — цель для {@link updateValue}. Для
     * default-профиля это `User/settings.json` (совпадает с user-слоем); для
     * именованного — файл профиля (profile-слой).
     */
    private readonly writeTargetPath: string | undefined;
    private readonly writesToProfileLayer: boolean;
    /** Путь к `User/settings.json` (user-слой) — для перечитывания при reload. */
    private readonly userSettingsPath: string | undefined;
    /** Путь к settings.json именованного профиля; undefined для default-профиля. */
    private readonly profileSettingsPath: string | undefined;
    private readonly logger: ILogger | undefined;
    private readonly schemas: ReadonlyMap<string, IConfigurationPropertySchema>;
    /** `scope` ключей ядра и расширений — фильтр и отказ записи в воркспейс. */
    private readonly scopes: ReadonlyMap<string, ConfigurationScope>;
    private readonly onDidChangeConfigurationEmitter = new Emitter<IConfigurationChangeEvent>();
    public readonly onDidChangeConfiguration = this.onDidChangeConfigurationEmitter.event;

    public constructor(input: {
        readonly defaultsLayer: ConfigurationModel;
        readonly userLayer: ConfigurationModel;
        readonly profileLayer: ConfigurationModel;
        /** Путь к settings.json активного профиля; без него запись недоступна. */
        readonly writeTargetPath?: string;
        /** true → правка ложится в profile-слой (именованный профиль). */
        readonly writesToProfileLayer?: boolean;
        /** Путь к `User/settings.json` — включает reload user-слоя. */
        readonly userSettingsPath?: string;
        /** Путь к settings.json именованного профиля — включает reload profile-слоя. */
        readonly profileSettingsPath?: string;
        /** Watcher: если передан вместе с путями — включает live-reload. */
        readonly fileWatcher?: IFileWatcher;
        readonly logger?: ILogger;
        /** Схемы ключей (из реестра): значение, не прошедшее схему, заменяется дефолтом. */
        readonly schemas?: ReadonlyMap<string, IConfigurationPropertySchema>;
        /** `scope` ключей ядра и расширений (из реестра): какие ключи действуют в воркспейсе. */
        readonly scopes?: ReadonlyMap<string, ConfigurationScope>;
    }) {
        super();
        this.defaultsLayer = input.defaultsLayer;
        this.userLayer = input.userLayer;
        this.profileLayer = input.profileLayer;
        this.writeTargetPath = input.writeTargetPath;
        this.writesToProfileLayer = input.writesToProfileLayer ?? false;
        this.userSettingsPath = input.userSettingsPath;
        this.profileSettingsPath = input.profileSettingsPath;
        this.logger = input.logger;
        this.schemas = input.schemas ?? new Map();
        this.scopes = input.scopes ?? new Map();
        this.fileWatcher = input.fileWatcher;
        this.snapshot = this.computeSnapshot();

        if (input.fileWatcher !== undefined) {
            this.startWatching(input.fileWatcher);
        }
    }

    /**
     * Подписывает reload на изменения settings.json. Следим за user-файлом
     * всегда (если путь известен) и за profile-файлом для именованного профиля.
     * Хендлы watch регистрируются в {@link Disposable} — чистятся на `dispose()`.
     */
    private startWatching(fileWatcher: IFileWatcher): void {
        const paths = new Set<string>();
        if (this.userSettingsPath !== undefined) paths.add(this.userSettingsPath);
        if (this.profileSettingsPath !== undefined) paths.add(this.profileSettingsPath);
        for (const filePath of paths) {
            this.register(
                fileWatcher.watchFile(filePath, () => {
                    void this.reload();
                }),
            );
        }
    }

    public get<K extends keyof IConfigurationKeys>(key: K, overrides?: IConfigurationOverrides): IConfigurationKeys[K];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T — приведение для чужих ключей, как у ConfigurationModel.get
    public get<T>(key: string, overrides?: IConfigurationOverrides): T | undefined;
    public get<T>(key: string, overrides?: IConfigurationOverrides): T | undefined {
        return this.snapshot.model(overrides).get<T>(key);
    }

    public getValue(section?: string): unknown {
        return this.snapshot.model().getValue(section);
    }

    public getConfigurationData(): IConfigurationData {
        return {
            defaults: this.defaultsLayer.toRaw(),
            user: ConfigurationModel.merge(this.userLayer, this.profileLayer).toRaw(),
            workspace: this.workspaceLayer.toRaw(),
        };
    }

    public inspect<T>(key: string, overrides?: IConfigurationOverrides): IConfigurationInspectResult<T> {
        return {
            default: this.defaultsLayer.get<T>(key),
            user: this.userLayer.get<T>(key),
            profile: this.profileLayer.get<T>(key),
            workspace: this.workspaceLayer.get<T>(key),
            value: this.snapshot.model(overrides).get<T>(key),
        };
    }

    /** Слои по приоритету; чтение — через снапшот (схема, секции языков). */
    private computeSnapshot(): ConfigurationSnapshot {
        return new ConfigurationSnapshot(
            ConfigurationModel.merge(this.defaultsLayer, this.userLayer, this.profileLayer, this.workspaceLayer),
            this.schemas,
        );
    }

    /**
     * Перечитывает settings.json с диска (user + profile, если именованный
     * профиль, + воркспейс, если открыта папка), пересобирает merged и эмитит
     * `onDidChangeConfiguration` с диффом. Ошибки чтения/парсинга трактуются как
     * пустой слой (тот же best-effort, что в bootstrap). Пустой дифф события не
     * порождает.
     */
    public async reload(): Promise<void> {
        const prev = this.snapshot;
        if (this.userSettingsPath !== undefined) {
            this.userLayer = await loadSettingsLayer(this.userSettingsPath, this.logger);
        }
        if (this.profileSettingsPath !== undefined) {
            this.profileLayer = await loadSettingsLayer(this.profileSettingsPath, this.logger);
        }
        await this.reloadWorkspaceLayer();
        this.recompute(prev);
    }

    /**
     * Папки воркспейса сменились (старт с папкой, Open Folder). Слой воркспейса
     * перечитывается из `.diode/settings.json` первой папки, watch переезжает на
     * её файл, событие изменения — по диффу, как при reload. Та же папка — no-op.
     *
     * Форма — список, как у `IWorkspace.folders`: при мульти-руте слой
     * воркспейса станет `.code-workspace`, а папки получат свои слои
     * (`docs/TODO/MultiRoot.md`, этапы D–E); сейчас папка не больше одной.
     */
    public async setWorkspaceFolders(folders: readonly string[]): Promise<void> {
        const folder = folders.at(0);
        const file = folder === undefined ? undefined : workspaceSettingsPath(path.resolve(folder));
        if (file === this.workspaceSettingsFile) return;
        this.workspaceSettingsFile = file;
        // Stryker disable next-line UpdateOperator: поколению важна только смена значения, а не направление
        const generation = ++this.workspaceGeneration;
        this.workspaceWatch.value =
            file === undefined
                ? undefined
                : this.fileWatcher?.watchFile(file, () => {
                      void this.reloadWorkspace();
                  });
        const prev = this.snapshot;
        const layer = file === undefined ? ConfigurationModel.EMPTY : await this.loadWorkspaceLayer(file);
        if (generation !== this.workspaceGeneration) return;
        this.workspaceLayer = layer;
        this.recompute(prev);
    }

    /** Перечитать только слой воркспейса (watch его файла). */
    private async reloadWorkspace(): Promise<void> {
        const prev = this.snapshot;
        await this.reloadWorkspaceLayer();
        this.recompute(prev);
    }

    private async reloadWorkspaceLayer(): Promise<void> {
        const file = this.workspaceSettingsFile;
        if (file === undefined) return;
        const generation = this.workspaceGeneration;
        const layer = await this.loadWorkspaceLayer(file);
        if (generation === this.workspaceGeneration) this.workspaceLayer = layer;
    }

    /** settings.json воркспейса без ключей чужого скоупа; отброшенные — warn в лог. */
    private async loadWorkspaceLayer(file: string): Promise<ConfigurationModel> {
        const { model, excludedKeys } = filterWorkspaceSettings(
            await loadSettingsLayer(file, this.logger),
            this.scopes,
        );
        if (excludedKeys.length > 0) {
            this.logger?.warn(
                `${file}: ignored settings that can be set only in User settings: ${excludedKeys.join(", ")}`,
            );
        }
        return model;
    }

    /**
     * Пересобирает merged из текущих слоёв и, если появился дифф ключей
     * относительно `prev`, эмитит событие изменения. Общая точка для reload и
     * {@link updateValue}.
     */
    private recompute(prev: ConfigurationSnapshot): void {
        this.snapshot = this.computeSnapshot();
        const event = this.snapshot.changeFrom(prev);
        if (event !== null) this.onDidChangeConfigurationEmitter.fire(event);
    }

    // Stryker disable next-line StringLiteral: любая цель, кроме "workspace", пишет в user — дефолт виден только типу
    public updateValue(key: string, value: unknown, target: ConfigurationTarget = "user"): Promise<void> {
        // Записи идут друг за другом: две параллельные правки одного файла
        // (расширения на старте) иначе прочитали бы одно и то же содержимое и
        // вторая затёрла бы первую. Отказ одной записи очередь не рвёт.
        const write = this.writeQueue.then(() => this.doUpdateValue(key, value, target));
        this.writeQueue = write.catch(() => undefined);
        return write;
    }

    private async doUpdateValue(key: string, value: unknown, target: ConfigurationTarget): Promise<void> {
        if (target === "workspace") {
            const file = this.workspaceSettingsFile;
            if (file === undefined) throw new Error(NO_WORKSPACE_OPENED_ERROR);
            const scopeError = workspaceScopeWriteError(key, this.scopes.get(key));
            if (scopeError !== null) throw new Error(scopeError);
            const model = await writeSettingsKey(file, key, value);
            const prev = this.snapshot;
            this.workspaceLayer = filterWorkspaceSettings(model, this.scopes).model;
            this.recompute(prev);
            return;
        }

        if (this.writeTargetPath === undefined) return;
        const model = await writeSettingsKey(this.writeTargetPath, key, value);
        // Обновляем in-memory слой, чтобы get/inspect сразу видели новое значение.
        const prev = this.snapshot;
        if (this.writesToProfileLayer) {
            this.profileLayer = model;
        } else {
            this.userLayer = model;
        }
        // Эмитим то же событие, что и watcher-reload. Последующий reload по
        // событию файлового watcher'а даст пустой дифф → без повторного события.
        this.recompute(prev);
    }
}

/**
 * JSONC-правка одного ключа в settings.json (с сохранением комментариев и
 * форматирования); `value: undefined` снимает ключ. Файла или каталога нет —
 * создаются. Возвращает модель нового содержимого.
 */
async function writeSettingsKey(filePath: string, key: string, value: unknown): Promise<ConfigurationModel> {
    let content = "";
    try {
        content = await fs.promises.readFile(filePath, "utf-8");
    } catch (err) {
        if (!isFileNotFound(err)) throw err;
        // Файла ещё нет — стартуем с пустого объекта, каталог создаём ниже.
    }

    // Пишем плоский dotted-ключ (`"workbench.colorTheme": …`) — так же, как это
    // делает VS Code и как выглядят фикстуры/дефолты. `ConfigurationModel`
    // при чтении сам разворачивает точечные ключи во вложенное дерево. Поэтому
    // ключ идёт ОДНИМ сегментом JSONPath, а не `key.split(".")`.
    const edits = modify(content, [key], value, {
        formattingOptions: { insertSpaces: true, tabSize: 4 },
    });
    const next = applyEdits(content, edits);

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    // Stryker disable next-line StringLiteral: пустая кодировка у writeFile — та же utf-8 по умолчанию
    await fs.promises.writeFile(filePath, next, "utf-8");
    // Stryker disable next-line ArrayDeclaration,ObjectLiteral,BooleanLiteral: ошибки разбора здесь не читаются, а парсер терпим к висячей запятой и без опции — модель та же
    return ConfigurationModel.fromRaw(parseJsonc(next, [], { allowTrailingComma: true }));
}

/**
 * Асинхронный bootstrap: читает settings.json (user + profile, если есть),
 * парсит как JSONC, собирает все слои в `ConfigurationService`.
 *
 * `paths.settingsFile` указывает на settings.json активного профиля. Для
 * default-профиля это `User/settings.json` и совпадает с user-слоем —
 * мы загружаем тот же файл дважды, но второй слой даёт пустой результат,
 * чтобы не дублировать значения (см. ниже).
 */
export async function loadConfiguration(
    paths: IUserDataPaths,
    logger?: ILogger,
    fileWatcher?: IFileWatcher,
    /**
     * Источник defaults-слоя. Production (`main.ts`) передаёт реестр, собранный
     * из `CONFIGURATION_CONTRIBUTIONS`; без него слой дефолтов пуст (юнит-тесты
     * слоёв user/profile).
     */
    registry?: ConfigurationRegistry,
    /**
     * Папка воркспейса, если окно открывается с ней: слой `.diode/settings.json`
     * читается ДО первого кадра (тема, `editor.*` проекта видны сразу). Смена
     * папки потом — {@link ConfigurationService.setWorkspaceFolders}.
     */
    workspaceFolder?: string,
): Promise<ConfigurationService> {
    const defaultsLayer = ConfigurationModel.fromRaw(registry?.getDefaultConfiguration() ?? {});

    const userSettingsPath = path.join(paths.userDir, "settings.json");
    const userLayer = await loadSettingsLayer(userSettingsPath, logger);

    const profileSettingsPath = paths.isDefaultProfile ? undefined : paths.settingsFile;
    let profileLayer = ConfigurationModel.EMPTY;
    if (profileSettingsPath !== undefined) {
        profileLayer = await loadSettingsLayer(profileSettingsPath, logger);
    }

    const service = new ConfigurationService({
        defaultsLayer,
        userLayer,
        profileLayer,
        // Запись идёт в settings.json активного профиля (default → User/settings.json).
        writeTargetPath: paths.settingsFile,
        writesToProfileLayer: !paths.isDefaultProfile,
        userSettingsPath,
        profileSettingsPath,
        fileWatcher,
        logger,
        schemas: registry?.getConfigurationProperties(),
        scopes: registry?.getConfigurationScopes(),
    });
    // Stryker disable next-line ConditionalExpression: `[undefined]` и `[]` для setWorkspaceFolders одно и то же — первая папка undefined
    await service.setWorkspaceFolders(workspaceFolder === undefined ? [] : [workspaceFolder]);
    return service;
}

async function loadSettingsLayer(filePath: string, logger: ILogger | undefined): Promise<ConfigurationModel> {
    let content: string;
    try {
        content = await fs.promises.readFile(filePath, "utf-8");
    } catch (err) {
        if (isFileNotFound(err)) return ConfigurationModel.EMPTY;
        logger?.error(`Failed to read settings file ${filePath}`, err);
        return ConfigurationModel.EMPTY;
    }

    const errors: ParseError[] = [];
    const parsed: unknown = parseJsonc(content, errors, { allowTrailingComma: true });
    if (errors.length > 0) {
        for (const err of errors) {
            logger?.error(
                `JSONC parse error in ${filePath} at offset ${String(err.offset)}: ${printParseErrorCode(err.error)}`,
            );
        }
        // Если ничего распарсить не удалось — пусто. Если parser вернул
        // частичный объект, используем его (поведение jsonc-parser совместимо
        // с VS Code: best-effort).
    }
    return ConfigurationModel.fromRaw(parsed);
}

function isFileNotFound(err: unknown): boolean {
    return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}
