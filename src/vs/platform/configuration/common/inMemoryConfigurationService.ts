import { Emitter } from "../../../base/common/event.ts";

import { ConfigurationModel } from "./configurationModel.ts";
import type { ConfigurationRegistry, IConfigurationPropertySchema } from "./configurationRegistry.ts";
import { ConfigurationSnapshot } from "./configurationSnapshot.ts";
import type {
    IConfigurationChangeEvent,
    IConfigurationData,
    IConfigurationInspectResult,
    IConfigurationKeys,
    IConfigurationOverrides,
    IConfigurationService,
} from "./iConfigurationService.ts";

/**
 * {@link IConfigurationService} без диска — аналог `TestConfigurationService`
 * VS Code. Дефолты — из того же {@link ConfigurationRegistry}, что и у
 * приложения, поэтому `get("editor.wordWrapColumn")` отвечает 80, а не
 * `undefined`; `updateValue` пишет в user-слой в памяти и эмитит то же событие
 * изменения, что файловая реализация.
 *
 * Профиля в памяти нет: запись и чтение идут в один user-слой.
 */
export class InMemoryConfigurationService implements IConfigurationService {
    private readonly defaultsLayer: ConfigurationModel;
    private readonly schemas: ReadonlyMap<string, IConfigurationPropertySchema>;
    /** Содержимое user-слоя в форме settings.json — запись заменяет ключ целиком, как в файле. */
    private readonly userSettings: Record<string, unknown>;
    private userLayer: ConfigurationModel;
    private snapshot: ConfigurationSnapshot;
    private readonly onDidChangeConfigurationEmitter = new Emitter<IConfigurationChangeEvent>();
    public readonly onDidChangeConfiguration = this.onDidChangeConfigurationEmitter.event;

    /**
     * @param registry источник defaults-слоя; без него дефолтов нет.
     * @param initial начальное содержимое user-слоя (форма settings.json: точечные
     *        ключи верхнего уровня разворачиваются, `"[lang]"` — секции языков).
     */
    public constructor(registry?: ConfigurationRegistry, initial: Readonly<Record<string, unknown>> = {}) {
        this.defaultsLayer = ConfigurationModel.fromRaw(registry?.getDefaultConfiguration() ?? {});
        this.schemas = registry?.getConfigurationProperties() ?? new Map();
        this.userSettings = { ...initial };
        this.userLayer = ConfigurationModel.fromRaw(this.userSettings);
        this.snapshot = this.computeSnapshot();
    }

    private computeSnapshot(): ConfigurationSnapshot {
        return new ConfigurationSnapshot(ConfigurationModel.merge(this.defaultsLayer, this.userLayer), this.schemas);
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
        return { defaults: this.defaultsLayer.toRaw(), user: this.userLayer.toRaw() };
    }

    public inspect<T>(key: string, overrides?: IConfigurationOverrides): IConfigurationInspectResult<T> {
        return {
            default: this.defaultsLayer.get<T>(key),
            user: this.userLayer.get<T>(key),
            profile: undefined,
            value: this.snapshot.model(overrides).get<T>(key),
        };
    }

    public updateValue(key: string, value: unknown): Promise<void> {
        const prev = this.snapshot;
        // Тот же плоский точечный ключ, что пишет файловая реализация в settings.json.
        this.userSettings[key] = value;
        this.userLayer = ConfigurationModel.fromRaw(this.userSettings);
        this.snapshot = this.computeSnapshot();
        const event = this.snapshot.changeFrom(prev);
        if (event !== null) this.onDidChangeConfigurationEmitter.fire(event);
        return Promise.resolve();
    }
}
