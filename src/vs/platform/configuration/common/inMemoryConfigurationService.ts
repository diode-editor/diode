import { Emitter } from "../../../base/common/event.ts";

import { ConfigurationModel } from "./configurationModel.ts";
import type {
    ConfigurationRegistry,
    ConfigurationScope,
    IConfigurationPropertySchema,
} from "./configurationRegistry.ts";
import { ConfigurationSnapshot } from "./configurationSnapshot.ts";
import { filterWorkspaceSettings } from "./configurationValidation.ts";
import type {
    ConfigurationTarget,
    IConfigurationChangeEvent,
    IConfigurationData,
    IConfigurationInspectResult,
    IConfigurationKeys,
    IConfigurationOverrides,
    IConfigurationService,
} from "./iConfigurationService.ts";
import { NO_WORKSPACE_OPENED_ERROR, workspaceScopeWriteError } from "./workspaceSettings.ts";

/**
 * {@link IConfigurationService} без диска — аналог `TestConfigurationService`
 * VS Code. Дефолты — из того же {@link ConfigurationRegistry}, что и у
 * приложения, поэтому `get("editor.wordWrapColumn")` отвечает 80, а не
 * `undefined`; `updateValue` пишет в user- или workspace-слой в памяти и эмитит
 * то же событие изменения, что файловая реализация.
 *
 * Профиля в памяти нет: запись и чтение идут в один user-слой. Слой воркспейса
 * есть, если его содержимое передано (пусть и пустое `{}`); без него окно
 * считается пустым — запись в воркспейс отклоняется, как у файловой реализации.
 */
export class InMemoryConfigurationService implements IConfigurationService {
    private readonly defaultsLayer: ConfigurationModel;
    private readonly schemas: ReadonlyMap<string, IConfigurationPropertySchema>;
    /** `scope` ключей ядра и расширений — фильтр и отказ записи в воркспейс. */
    private readonly scopes: ReadonlyMap<string, ConfigurationScope>;
    /** Содержимое user-слоя в форме settings.json — запись заменяет ключ целиком, как в файле. */
    private readonly userSettings: Record<string, unknown>;
    /** Содержимое `.diode/settings.json` воркспейса; `null` — папка не открыта. */
    private readonly workspaceSettings: Record<string, unknown> | null;
    private userLayer: ConfigurationModel;
    private workspaceLayer: ConfigurationModel;
    private snapshot: ConfigurationSnapshot;
    private readonly onDidChangeConfigurationEmitter = new Emitter<IConfigurationChangeEvent>();
    public readonly onDidChangeConfiguration = this.onDidChangeConfigurationEmitter.event;

    /**
     * @param registry источник defaults-слоя; без него дефолтов нет.
     * @param initial начальное содержимое user-слоя (форма settings.json: точечные
     *        ключи верхнего уровня разворачиваются, `"[lang]"` — секции языков).
     * @param workspace содержимое settings.json воркспейса в той же форме;
     *        не передан — папка не открыта.
     */
    public constructor(
        registry?: ConfigurationRegistry,
        initial: Readonly<Record<string, unknown>> = {},
        workspace?: Readonly<Record<string, unknown>>,
    ) {
        this.defaultsLayer = ConfigurationModel.fromRaw(registry?.getDefaultConfiguration() ?? {});
        this.schemas = registry?.getConfigurationProperties() ?? new Map();
        this.scopes = registry?.getConfigurationScopes() ?? new Map();
        this.userSettings = { ...initial };
        this.userLayer = ConfigurationModel.fromRaw(this.userSettings);
        this.workspaceSettings = workspace === undefined ? null : { ...workspace };
        this.workspaceLayer = this.computeWorkspaceLayer();
        this.snapshot = this.computeSnapshot();
    }

    private computeWorkspaceLayer(): ConfigurationModel {
        // Stryker disable next-line ConditionalExpression: fromRaw(null) — тот же пустой слой; ветка нужна типу
        if (this.workspaceSettings === null) return ConfigurationModel.EMPTY;
        return filterWorkspaceSettings(ConfigurationModel.fromRaw(this.workspaceSettings), this.scopes).model;
    }

    private computeSnapshot(): ConfigurationSnapshot {
        return new ConfigurationSnapshot(
            ConfigurationModel.merge(this.defaultsLayer, this.userLayer, this.workspaceLayer),
            this.schemas,
        );
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
            user: this.userLayer.toRaw(),
            workspace: this.workspaceLayer.toRaw(),
        };
    }

    public inspect<T>(key: string, overrides?: IConfigurationOverrides): IConfigurationInspectResult<T> {
        return {
            default: this.defaultsLayer.get<T>(key),
            user: this.userLayer.get<T>(key),
            profile: undefined,
            workspace: this.workspaceLayer.get<T>(key),
            value: this.snapshot.model(overrides).get<T>(key),
        };
    }

    // Stryker disable next-line StringLiteral: любая цель, кроме "workspace", пишет в user — дефолт виден только типу
    public updateValue(key: string, value: unknown, target: ConfigurationTarget = "user"): Promise<void> {
        const prev = this.snapshot;
        if (target === "workspace") {
            if (this.workspaceSettings === null) return Promise.reject(new Error(NO_WORKSPACE_OPENED_ERROR));
            const scopeError = workspaceScopeWriteError(key, this.scopes.get(key));
            if (scopeError !== null) return Promise.reject(new Error(scopeError));
            writeKey(this.workspaceSettings, key, value);
            this.workspaceLayer = this.computeWorkspaceLayer();
        } else {
            // Тот же плоский точечный ключ, что пишет файловая реализация в settings.json.
            writeKey(this.userSettings, key, value);
            this.userLayer = ConfigurationModel.fromRaw(this.userSettings);
        }
        this.snapshot = this.computeSnapshot();
        const event = this.snapshot.changeFrom(prev);
        if (event !== null) this.onDidChangeConfigurationEmitter.fire(event);
        return Promise.resolve();
    }
}

/** `undefined` снимает ключ (как `jsonc-parser.modify` с `undefined` в файле). */
function writeKey(settings: Record<string, unknown>, key: string, value: unknown): void {
    if (value === undefined) {
        Reflect.deleteProperty(settings, key);
    } else {
        settings[key] = value;
    }
}
