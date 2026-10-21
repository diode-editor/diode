import * as fs from "node:fs";
import * as path from "node:path";

import { applyEdits, modify, parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser";

import { Emitter } from "../../../base/common/event.ts";
import { Disposable, type IDisposable, MutableDisposable } from "../../../base/common/lifecycle.ts";
import { isFileNotFound } from "../../../base/node/fsErrors.ts";
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
import { filterWorkspaceSettings, pickRegisteredSettings } from "../common/configurationValidation.ts";
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
    APPLICATION_SCOPES,
    FOLDER_SCOPES,
    folderScopeWriteError,
    NO_WORKSPACE_OPENED_ERROR,
    PROFILE_SCOPES,
    WORKSPACE_SCOPES,
    workspaceScopeWriteError,
    workspaceSettingsPath,
} from "../common/workspaceSettings.ts";

interface ISettingsSource {
    readonly file: string;
    /** Ключ блока настроек внутри файла (`settings` у `.code-workspace`); нет — весь файл. */
    readonly section: string | undefined;
    readonly scopes: readonly ConfigurationScope[];
    readonly ignoredReason: string;
}

/**
 * Слои по возрастанию приоритета (как `ApplicationConfiguration`/`UserConfiguration` эталона):
 *   1. defaults реестра;
 *   2. user — `User/settings.json`; у именованного профиля урезан до `APPLICATION_SCOPES`;
 *   3. profile — файл именованного профиля, ключи `PROFILE_SCOPES`;
 *   4. workspace — `.diode/settings.json` папки или блок `settings` файла `.code-workspace`;
 *   5. workspaceFolder — только у окна из `.code-workspace`: файл папки, ключи `FOLDER_SCOPES`.
 *
 * Битый JSONC — пустой слой с ошибкой в лог: bootstrap не должен падать из-за settings.json.
 */
export class ConfigurationService extends Disposable implements IConfigurationService {
    private readonly defaultsLayer: ConfigurationModel;
    private userLayer: ConfigurationModel;
    private profileLayer: ConfigurationModel;
    private workspaceLayer = ConfigurationModel.EMPTY;
    private folderLayer = ConfigurationModel.EMPTY;
    private snapshot: ConfigurationSnapshot;
    private workspaceSource: ISettingsSource | undefined;
    private folderSource: ISettingsSource | undefined;
    private readonly workspaceWatch = this.register(new MutableDisposable());
    private readonly folderWatch = this.register(new MutableDisposable());
    private readonly fileWatcher: IFileWatcher | undefined;
    /** Загрузка слоя, закончившаяся после следующей смены папки, результат не применяет. */
    private workspaceGeneration = 0;
    /** Read-modify-write одного файла не должны перекрываться. */
    private writeQueue: Promise<void> = Promise.resolve();
    private readonly writeTargetPath: string | undefined;
    private readonly writesToProfileLayer: boolean;
    private readonly userSettingsPath: string | undefined;
    private readonly profileSettingsPath: string | undefined;
    private readonly logger: ILogger | undefined;
    /** Уже названный warn'ом набор: файл профиля перечитывается на каждую запись, повтор — шум. */
    private warnedProfileKeys: string | undefined;
    private readonly schemas: ReadonlyMap<string, IConfigurationPropertySchema>;
    private readonly scopes: ReadonlyMap<string, ConfigurationScope>;
    private readonly onDidChangeConfigurationEmitter = new Emitter<IConfigurationChangeEvent>();
    public readonly onDidChangeConfiguration = this.onDidChangeConfigurationEmitter.event;

    public constructor(input: {
        readonly defaultsLayer: ConfigurationModel;
        readonly userLayer: ConfigurationModel;
        readonly profileLayer: ConfigurationModel;
        /** Без него запись недоступна. */
        readonly writeTargetPath?: string;
        readonly writesToProfileLayer?: boolean;
        readonly userSettingsPath?: string;
        readonly profileSettingsPath?: string;
        readonly fileWatcher?: IFileWatcher;
        readonly logger?: ILogger;
        readonly schemas?: ReadonlyMap<string, IConfigurationPropertySchema>;
        readonly scopes?: ReadonlyMap<string, ConfigurationScope>;
    }) {
        super();
        this.defaultsLayer = input.defaultsLayer;
        this.writeTargetPath = input.writeTargetPath;
        this.writesToProfileLayer = input.writesToProfileLayer ?? false;
        this.userSettingsPath = input.userSettingsPath;
        this.profileSettingsPath = input.profileSettingsPath;
        this.logger = input.logger;
        this.schemas = input.schemas ?? new Map();
        this.scopes = input.scopes ?? new Map();
        this.fileWatcher = input.fileWatcher;
        // Фильтры скоупов профиля — здесь, чтобы bootstrap, reload и запись делили одну семантику.
        this.userLayer = this.toUserLayer(input.userLayer);
        this.profileLayer = this.toProfileLayer(input.profileLayer);
        this.snapshot = this.computeSnapshot();

        if (input.fileWatcher !== undefined) {
            this.startWatching(input.fileWatcher);
        }
    }

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

    public async reload(): Promise<void> {
        const prev = this.snapshot;
        if (this.userSettingsPath !== undefined) {
            this.userLayer = this.toUserLayer(await loadSettingsLayer(this.userSettingsPath, this.logger));
        }
        if (this.profileSettingsPath !== undefined) {
            this.profileLayer = this.toProfileLayer(await loadSettingsLayer(this.profileSettingsPath, this.logger));
        }
        await this.reloadWorkspaceLayers();
        this.recompute(prev);
    }

    /** Отброшенное не логируется: это не ошибка файла, а норма наследования. */
    private toUserLayer(model: ConfigurationModel): ConfigurationModel {
        if (this.profileSettingsPath === undefined) return model;
        return pickRegisteredSettings(model, this.scopes, APPLICATION_SCOPES);
    }

    private toProfileLayer(model: ConfigurationModel): ConfigurationModel {
        const { model: filtered, excludedKeys } = filterWorkspaceSettings(model, this.scopes, PROFILE_SCOPES);
        const ignored =
            // Stryker disable next-line StringLiteral: разделитель списка ключей в тексте лога
            excludedKeys.length > 0 && this.profileSettingsPath !== undefined ? excludedKeys.join(", ") : undefined;
        if (ignored !== undefined && ignored !== this.warnedProfileKeys) {
            this.logger?.warn(
                `${this.profileSettingsPath}: ignored settings that apply to all profiles (set them in the Default profile): ${ignored}`,
            );
        }
        this.warnedProfileKeys = ignored;
        return filtered;
    }

    /** Список, как `IWorkspace.folders`, под мульти-рут (`docs/TODO/MultiRoot.md`, этап D); сейчас папка не больше одной. */
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

    /** Пустой дифф события не порождает: reload после собственной записи молчит. */
    private recompute(prev: ConfigurationSnapshot): void {
        this.snapshot = this.computeSnapshot();
        const event = this.snapshot.changeFrom(prev);
        if (event !== null) this.onDidChangeConfigurationEmitter.fire(event);
    }

    // Stryker disable next-line StringLiteral: любая цель, кроме "workspace", пишет в user — дефолт виден только типу
    public updateValue(key: string, value: unknown, target: ConfigurationTarget = "user"): Promise<void> {
        // Две параллельные правки одного файла (расширения на старте) иначе прочитали
        // бы одно содержимое, и вторая затёрла бы первую. Отказ одной очередь не рвёт.
        const write = this.writeQueue.then(() => this.doUpdateValue(key, value, target));
        this.writeQueue = write.catch(() => undefined);
        return write;
    }

    private async doUpdateValue(key: string, value: unknown, target: ConfigurationTarget): Promise<void> {
        if (target === "workspace" || target === "workspaceFolder") {
            // Цель-папка у окна из папки — тот же файл, что у воркспейса (`getConfigurationFileResource` эталона).
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
        // `application`-ключ пишется в Default-профиль и действует во всех (`isSettingAppliedForAllProfiles` эталона).
        const scope = this.scopes.get(key);
        // Stryker disable next-line ConditionalExpression: `scope !== undefined` — защита типа (includes(undefined) и так false); у Default `User/settings.json` и есть цель записи, обе ветки ниже совпадают
        const toDefaultProfile = this.writesToProfileLayer && scope !== undefined && APPLICATION_SCOPES.includes(scope);
        const userSettingsPath = toDefaultProfile ? this.userSettingsPath : undefined;
        if (userSettingsPath !== undefined) {
            const model = await writeSettingsKey(userSettingsPath, key, value);
            const prev = this.snapshot;
            this.userLayer = this.toUserLayer(model);
            this.recompute(prev);
            return;
        }
        const model = await writeSettingsKey(this.writeTargetPath, key, value);
        const prev = this.snapshot;
        if (this.writesToProfileLayer) {
            this.profileLayer = this.toProfileLayer(model);
        } else {
            this.userLayer = model;
        }
        this.recompute(prev);
    }
}

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
    }

    // Плоский dotted-ключ, как пишет VS Code: ОДИН сегмент JSONPath, а не `key.split(".")`.
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

function sectionOf(parsed: unknown, section: string | undefined): unknown {
    if (section === undefined) return parsed;
    return (parsed as Record<string, unknown> | null | undefined)?.[section];
}

/** Слои читаются как есть, фильтры скоупов профиля применяет сам сервис. */
export async function loadConfiguration(
    paths: IUserDataPaths,
    logger?: ILogger,
    fileWatcher?: IFileWatcher,
    registry?: ConfigurationRegistry,
    /** Слои воркспейса читаются ДО первого кадра: тема и `editor.*` проекта видны сразу. */
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
        // Частичный объект парсера используется, как у VS Code (best-effort).
    }
    return ConfigurationModel.fromRaw(sectionOf(parsed, section));
}
