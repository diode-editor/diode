import { Emitter } from "../../../base/common/event.ts";

import { createConfigurationChangeEvent, diffConfigurationKeys } from "./configurationChangeEvent.ts";
import { ConfigurationModel } from "./configurationModel.ts";
import type { ConfigurationRegistry } from "./configurationRegistry.ts";
import type {
    IConfigurationChangeEvent,
    IConfigurationInspectResult,
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
    /** Содержимое user-слоя в форме settings.json — запись заменяет ключ целиком, как в файле. */
    private readonly userSettings: Record<string, unknown>;
    private userLayer: ConfigurationModel;
    private merged: ConfigurationModel;
    private readonly onDidChangeConfigurationEmitter = new Emitter<IConfigurationChangeEvent>();
    public readonly onDidChangeConfiguration = this.onDidChangeConfigurationEmitter.event;

    /**
     * @param registry источник defaults-слоя; без него дефолтов нет.
     * @param initial начальное содержимое user-слоя (форма settings.json: точечные
     *        ключи верхнего уровня разворачиваются).
     */
    public constructor(registry?: ConfigurationRegistry, initial: Readonly<Record<string, unknown>> = {}) {
        this.defaultsLayer = ConfigurationModel.fromRaw(registry?.getDefaultConfiguration() ?? {});
        this.userSettings = { ...initial };
        this.userLayer = ConfigurationModel.fromRaw(this.userSettings);
        this.merged = ConfigurationModel.merge(this.defaultsLayer, this.userLayer);
    }

    public get<T>(key: string, defaultValue?: T): T | undefined {
        return this.merged.get<T>(key) ?? defaultValue;
    }

    public getValue(section?: string): unknown {
        return this.merged.getValue(section);
    }

    public inspect<T>(key: string): IConfigurationInspectResult<T> {
        return {
            default: this.defaultsLayer.get<T>(key),
            user: this.userLayer.get<T>(key),
            profile: undefined,
            value: this.merged.get<T>(key),
        };
    }

    public updateValue(key: string, value: unknown): Promise<void> {
        const prev = this.merged;
        // Тот же плоский точечный ключ, что пишет файловая реализация в settings.json.
        this.userSettings[key] = value;
        this.userLayer = ConfigurationModel.fromRaw(this.userSettings);
        this.merged = ConfigurationModel.merge(this.defaultsLayer, this.userLayer);
        const affectedKeys = diffConfigurationKeys(prev, this.merged);
        if (affectedKeys.length > 0) {
            this.onDidChangeConfigurationEmitter.fire(createConfigurationChangeEvent(affectedKeys));
        }
        return Promise.resolve();
    }
}
