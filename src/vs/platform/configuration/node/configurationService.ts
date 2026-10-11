import * as fs from "node:fs";
import * as path from "node:path";

import { applyEdits, modify, parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser";

import { Emitter } from "../../../base/common/event.ts";
import { Disposable, type IDisposable, MutableDisposable } from "../../../base/common/lifecycle.ts";
import type { IUserDataPaths } from "../../environment/node/userDataPaths.ts";
import type { IFileWatcher } from "../../files/common/iFileWatcher.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { WORKSPACE_FILE_SETTINGS_KEY } from "../../workspace/common/workspaceFile.ts";
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
    FOLDER_SCOPES,
    folderScopeWriteError,
    NO_WORKSPACE_OPENED_ERROR,
    WORKSPACE_SCOPES,
    workspaceScopeWriteError,
    workspaceSettingsPath,
} from "../common/workspaceSettings.ts";

/** Откуда читается слой воркспейса или папки. */
interface ISettingsSource {
    /** settings.json папки или файл `.code-workspace`. */
    readonly file: string;
    /** Ключ блока настроек внутри файла (`settings` у `.code-workspace`); нет — весь файл. */
    readonly section: string | undefined;
    /** Скоупы, которые слой принимает. */
    readonly scopes: readonly ConfigurationScope[];
    /** Почему отброшенные ключи не действуют — для warn'а в лог. */
    readonly ignoredReason: string;
}

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
 *      `scope` воркспейсу не положен; у окна, открытого файлом
 *      `.code-workspace`, — блок `settings` этого файла;
 *   5. workspaceFolder — только у окна из файла `.code-workspace`:
 *      `.diode/settings.json` его папки, ключи `FOLDER_SCOPES` (как у эталона,
 *      `window`-ключ папки тогда не действует).
 *   Что открыто, сервису сообщает {@link ConfigurationService.setWorkspace}: на
 *   старте, при Open Folder и Open Workspace from File. Без папки оба слоя пусты.
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
    private folderLayer = ConfigurationModel.EMPTY;
    private snapshot: ConfigurationSnapshot;
    /** Источник слоя воркспейса; `undefined` — папка не открыта. */
    private workspaceSource: ISettingsSource | undefined;
    /** Источник слоя папки; есть только у окна из файла `.code-workspace`. */
    private folderSource: ISettingsSource | undefined;
    /** Watch на файлы слоёв воркспейса и папки — меняются вместе с воркспейсом. */
    private readonly workspaceWatch = this.register(new MutableDisposable());
    private readonly folderWatch = this.register(new MutableDisposable());
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
            workspaceFolder: this.folderLayer.toRaw(),
        };
    }

    public inspect<T>(key: string, overrides?: IConfigurationOverrides): IConfigurationInspectResult<T> {
        return {
            default: this.defaultsLayer.get<T>(key),
            user: this.userLayer.get<T>(key),
            profile: this.profileLayer.get<T>(key),
            workspace: this.workspaceLayer.get<T>(key),
            workspaceFolder: this.folderLayer.get<T>(key),
            value: this.snapshot.model(overrides).get<T>(key),
        };
    }

    /** Слои по приоритету; чтение — через снапшот (схема, секции языков). */
    private computeSnapshot(): ConfigurationSnapshot {
        return new ConfigurationSnapshot(
            ConfigurationModel.merge(
                this.defaultsLayer,
                this.userLayer,
                this.profileLayer,
                this.workspaceLayer,
                this.folderLayer,
            ),
            this.schemas,
        );
    }

    /**
     * Перечитывает settings.json с диска (user + profile, если именованный
     * профиль, + воркспейс и папка, если открыты), пересобирает merged и эмитит
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
        await this.reloadWorkspaceLayers();
        this.recompute(prev);
    }

    /**
     * Воркспейс окна сменился (старт с папкой или файлом `.code-workspace`, Open
     * Folder, Open Workspace from File). Слои воркспейса и папки перечитываются
     * из своих источников ({@link workspaceSources}), watch переезжает на их
     * файлы, событие изменения — по диффу, как при reload. Те же источники —
     * no-op.
     *
     * Форма папок — список, как у `IWorkspace.folders`: при мульти-руте у каждой
     * папки будет свой слой (`docs/TODO/MultiRoot.md`, этап D); сейчас папка не
     * больше одной.
     */
    public async setWorkspace(folders: readonly string[], configuration?: string): Promise<void> {
        const sources = workspaceSources(folders, configuration);
        if (sameSource(sources.workspace, this.workspaceSource) && sameSource(sources.folder, this.folderSource))
            return;
        this.workspaceSource = sources.workspace;
        this.folderSource = sources.folder;
        // Stryker disable next-line UpdateOperator: поколению важна только смена значения, а не направление
        const generation = ++this.workspaceGeneration;
        // Watch папки снимается ДО новых: её файл переходит из слоя папки в слой
        // воркспейса (окно из файла → та же папка напрямую), и снятие прежнего
        // watch'а того же пути после нового сняло бы и новый. Обратный переход
        // безопасен и так: watch воркспейса переставляется первым.
        this.folderWatch.clear();
        this.workspaceWatch.value = this.watchSource(sources.workspace);
        this.folderWatch.value = this.watchSource(sources.folder);
        const prev = this.snapshot;
        const [workspaceLayer, folderLayer] = await Promise.all([
            this.loadSourceLayer(sources.workspace),
            this.loadSourceLayer(sources.folder),
        ]);
        if (generation !== this.workspaceGeneration) return;
        this.workspaceLayer = workspaceLayer;
        this.folderLayer = folderLayer;
        this.recompute(prev);
    }

    private watchSource(source: ISettingsSource | undefined): IDisposable | undefined {
        if (source === undefined) return undefined;
        return this.fileWatcher?.watchFile(source.file, () => {
            void this.reloadWorkspace();
        });
    }

    /** Перечитать только слои воркспейса и папки (watch их файлов). */
    private async reloadWorkspace(): Promise<void> {
        const prev = this.snapshot;
        await this.reloadWorkspaceLayers();
        this.recompute(prev);
    }

    private async reloadWorkspaceLayers(): Promise<void> {
        const generation = this.workspaceGeneration;
        const [workspaceLayer, folderLayer] = await Promise.all([
            this.loadSourceLayer(this.workspaceSource),
            this.loadSourceLayer(this.folderSource),
        ]);
        if (generation !== this.workspaceGeneration) return;
        this.workspaceLayer = workspaceLayer;
        this.folderLayer = folderLayer;
    }

    /** Слой из источника без ключей чужого скоупа; отброшенные — warn в лог. */
    private async loadSourceLayer(source: ISettingsSource | undefined): Promise<ConfigurationModel> {
        if (source === undefined) return ConfigurationModel.EMPTY;
        const { model, excludedKeys } = filterWorkspaceSettings(
            await loadSettingsLayer(source.file, this.logger, source.section),
            this.scopes,
            source.scopes,
        );
        if (excludedKeys.length > 0) {
            this.logger?.warn(
                `${source.file}: ignored settings that ${source.ignoredReason}: ${excludedKeys.join(", ")}`,
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
        if (target === "workspace" || target === "workspaceFolder") {
            // Цель-папка у окна из папки — тот же `.diode/settings.json`, что у
            // воркспейса (`getConfigurationFileResource` эталона), а у окна из
            // `.code-workspace` — свой файл папки.
            const source = target === "workspace" ? this.workspaceSource : (this.folderSource ?? this.workspaceSource);
            if (source === undefined) throw new Error(NO_WORKSPACE_OPENED_ERROR);
            const scope = this.scopes.get(key);
            const scopeError =
                target === "workspace" ? workspaceScopeWriteError(key, scope) : folderScopeWriteError(key, scope);
            if (scopeError !== null) throw new Error(scopeError);
            const model = await writeSettingsKey(source.file, key, value, source.section);
            const prev = this.snapshot;
            const layer = filterWorkspaceSettings(model, this.scopes, source.scopes).model;
            if (source === this.folderSource) this.folderLayer = layer;
            else this.workspaceLayer = layer;
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
 * Источники слоёв воркспейса и папки для открытого в окне (`IWorkspace`
 * эталона → `WorkspaceConfiguration` / `FolderConfiguration`):
 *
 * - папка открыта напрямую — слой воркспейса = её `.diode/settings.json`;
 * - окно из `.code-workspace` — слой воркспейса = блок `settings` файла, а
 *   `.diode/settings.json` папки — слой папки с `FOLDER_SCOPES`.
 */
function workspaceSources(
    folders: readonly string[],
    configuration: string | undefined,
): {
    readonly workspace?: ISettingsSource;
    readonly folder?: ISettingsSource;
} {
    const folder = folders.at(0);
    if (folder === undefined) return {};
    const folderSettings = workspaceSettingsPath(path.resolve(folder));
    const userOnly = "can be set only in User settings";
    if (configuration === undefined) {
        return {
            workspace: { file: folderSettings, section: undefined, scopes: WORKSPACE_SCOPES, ignoredReason: userOnly },
        };
    }
    return {
        workspace: {
            file: path.resolve(configuration),
            section: WORKSPACE_FILE_SETTINGS_KEY,
            scopes: WORKSPACE_SCOPES,
            ignoredReason: userOnly,
        },
        folder: {
            file: folderSettings,
            section: undefined,
            scopes: FOLDER_SCOPES,
            ignoredReason: "cannot be applied in this workspace (set them in the workspace file)",
        },
    };
}

/** Тот же источник — тот же файл: блок настроек в нём определяется видом файла. */
function sameSource(a: ISettingsSource | undefined, b: ISettingsSource | undefined): boolean {
    return a?.file === b?.file;
}

/**
 * JSONC-правка одного ключа в settings.json (с сохранением комментариев и
 * форматирования); `value: undefined` снимает ключ. Файла или каталога нет —
 * создаются. `section` — блок настроек внутри файла (`settings` у
 * `.code-workspace`): ключ пишется в него. Возвращает модель нового
 * содержимого этого блока.
 */
async function writeSettingsKey(
    filePath: string,
    key: string,
    value: unknown,
    section?: string,
): Promise<ConfigurationModel> {
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
    const edits = modify(content, section === undefined ? [key] : [section, key], value, {
        formattingOptions: { insertSpaces: true, tabSize: 4 },
    });
    const next = applyEdits(content, edits);

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    // Stryker disable next-line StringLiteral: пустая кодировка у writeFile — та же utf-8 по умолчанию
    await fs.promises.writeFile(filePath, next, "utf-8");
    // Stryker disable next-line ArrayDeclaration,ObjectLiteral,BooleanLiteral: ошибки разбора здесь не читаются, а парсер терпим к висячей запятой и без опции — модель та же
    return ConfigurationModel.fromRaw(sectionOf(parseJsonc(next, [], { allowTrailingComma: true }), section));
}

/** Блок `section` разобранного файла; без `section` — весь файл. */
function sectionOf(parsed: unknown, section: string | undefined): unknown {
    if (section === undefined) return parsed;
    // У `null` и примитивов полей нет — `undefined`, то есть пустой слой.
    return (parsed as Record<string, unknown> | null | undefined)?.[section];
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
     * Что окно открывает на старте: папка и, если через него, файл
     * `.code-workspace`. Слои воркспейса читаются ДО первого кадра (тема,
     * `editor.*` проекта видны сразу). Смена потом —
     * {@link ConfigurationService.setWorkspace}.
     */
    workspace?: { readonly folder: string; readonly configuration?: string | undefined },
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
    await service.setWorkspace(workspace === undefined ? [] : [workspace.folder], workspace?.configuration);
    return service;
}

async function loadSettingsLayer(
    filePath: string,
    logger: ILogger | undefined,
    section?: string,
): Promise<ConfigurationModel> {
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
    return ConfigurationModel.fromRaw(sectionOf(parsed, section));
}

function isFileNotFound(err: unknown): boolean {
    return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}
