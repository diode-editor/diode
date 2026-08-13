import * as fs from "node:fs";
import * as path from "node:path";

import { applyEdits, modify, parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser";

import { Disposable, type IDisposable } from "@tuidom/all/common/disposable";
import type { IUserDataPaths } from "../../environment/node/userDataPaths.ts";
import type { IFileWatcher } from "../../files/common/iFileWatcher.ts";
import type { ILogger } from "../../log/common/iLogger.ts";
import { ConfigurationModel } from "../common/configurationModel.ts";
import type { ConfigurationRegistry } from "../common/configurationRegistry.ts";
import type {
    IConfigurationChangeEvent,
    IConfigurationInspectResult,
    IConfigurationService,
} from "../common/iConfigurationService.ts";

/**
 * Реализация {@link IConfigurationService}.
 *
 * Слои (в порядке возрастания приоритета):
 *   1. defaults — из `ConfigurationRegistry` (узлы `CONFIGURATION_CONTRIBUTIONS`);
 *   2. user — `User/settings.json` (default-профиль);
 *   3. profile — `User/profiles/<name>/settings.json` (только если активный
 *      профиль не default, иначе пусто).
 *
 * Live-reload: если в конструктор передан {@link IFileWatcher} и пути к
 * settings.json, сервис следит за файлом(-ами) и на изменение перечитывает
 * соответствующий слой, пересобирает merged и эмитит `onDidChangeConfiguration`
 * с диффом затронутых ключей. Правки через {@link updateUserValue} эмитят то же
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
    private merged: ConfigurationModel;
    /**
     * settings.json активного профиля — цель для {@link updateUserValue}. Для
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
    private readonly listeners: ((event: IConfigurationChangeEvent) => void)[] = [];

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
        this.merged = ConfigurationModel.merge(this.defaultsLayer, this.userLayer, this.profileLayer);

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

    public get<T>(key: string, defaultValue?: T): T | undefined {
        const v = this.merged.get<T>(key);
        return v ?? defaultValue;
    }

    public getValue(section?: string): unknown {
        return this.merged.getValue(section);
    }

    public inspect<T>(key: string): IConfigurationInspectResult<T> {
        return {
            default: this.defaultsLayer.get<T>(key),
            user: this.userLayer.get<T>(key),
            profile: this.profileLayer.get<T>(key),
            value: this.merged.get<T>(key),
        };
    }

    public onDidChangeConfiguration(listener: (event: IConfigurationChangeEvent) => void): IDisposable {
        this.listeners.push(listener);
        return {
            dispose: () => {
                const index = this.listeners.indexOf(listener);
                if (index >= 0) this.listeners.splice(index, 1);
            },
        };
    }

    /**
     * Перечитывает settings.json с диска (user + profile, если именованный
     * профиль), пересобирает merged и эмитит `onDidChangeConfiguration` с
     * диффом. Ошибки чтения/парсинга трактуются как пустой слой (тот же
     * best-effort, что в bootstrap). Пустой дифф события не порождает.
     */
    public async reload(): Promise<void> {
        const prev = this.merged;
        if (this.userSettingsPath !== undefined) {
            this.userLayer = await loadSettingsLayer(this.userSettingsPath, this.logger);
        }
        if (this.profileSettingsPath !== undefined) {
            this.profileLayer = await loadSettingsLayer(this.profileSettingsPath, this.logger);
        }
        this.recompute(prev);
    }

    /**
     * Пересобирает merged из текущих слоёв и, если появился дифф ключей
     * относительно `prev`, эмитит событие изменения. Общая точка для reload и
     * {@link updateUserValue}.
     */
    private recompute(prev: ConfigurationModel): void {
        this.merged = ConfigurationModel.merge(this.defaultsLayer, this.userLayer, this.profileLayer);
        const affectedKeys = diffConfigurationKeys(prev, this.merged);
        if (affectedKeys.length === 0) return;
        const event = createConfigurationChangeEvent(affectedKeys);
        // Копия списка: слушатель может отписаться/подписаться в обработчике.
        for (const listener of [...this.listeners]) {
            listener(event);
        }
    }

    public async updateUserValue(key: string, value: unknown): Promise<void> {
        if (this.writeTargetPath === undefined) return;

        let content = "";
        try {
            content = await fs.promises.readFile(this.writeTargetPath, "utf-8");
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

        await fs.promises.mkdir(path.dirname(this.writeTargetPath), { recursive: true });
        await fs.promises.writeFile(this.writeTargetPath, next, "utf-8");

        // Обновляем in-memory слой, чтобы get/inspect сразу видели новое значение.
        const prev = this.merged;
        const parsed: unknown = parseJsonc(next, [], { allowTrailingComma: true });
        const model = ConfigurationModel.fromRaw(parsed);
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
 * Множество точечных ключей, значение которых различается между двумя
 * моделями. Используется для `affectedKeys` события изменения. Значения
 * сравниваются структурно (config всегда JSON-совместим).
 */
export function diffConfigurationKeys(prev: ConfigurationModel, next: ConfigurationModel): string[] {
    const keys = new Set<string>([...prev.collectKeys(), ...next.collectKeys()]);
    const changed: string[] = [];
    for (const key of keys) {
        if (!valuesEqual(prev.get(key), next.get(key))) changed.push(key);
    }
    return changed;
}

function valuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Собирает {@link IConfigurationChangeEvent} из списка изменившихся ключей.
 * `affectsConfiguration(q)` — true, если `q` совпадает с затронутым ключом,
 * является его предком (`editor` ← `editor.tabSize`) или потомком.
 */
export function createConfigurationChangeEvent(affectedKeys: readonly string[]): IConfigurationChangeEvent {
    return {
        affectedKeys,
        affectsConfiguration(key: string): boolean {
            return affectedKeys.some((k) => k === key || k.startsWith(`${key}.`) || key.startsWith(`${k}.`));
        },
    };
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
): Promise<ConfigurationService> {
    const defaultsLayer = ConfigurationModel.fromRaw(registry?.getDefaultConfiguration() ?? {});

    const userSettingsPath = path.join(paths.userDir, "settings.json");
    const userLayer = await loadSettingsLayer(userSettingsPath, logger);

    const profileSettingsPath = paths.isDefaultProfile ? undefined : paths.settingsFile;
    let profileLayer = ConfigurationModel.EMPTY;
    if (profileSettingsPath !== undefined) {
        profileLayer = await loadSettingsLayer(profileSettingsPath, logger);
    }

    return new ConfigurationService({
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
    });
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
