import type { IDisposable } from "../../../base/common/lifecycle.ts";

import type {
    IConfigurationChangeEvent,
    IConfigurationData,
    IConfigurationInspectResult,
    IConfigurationService,
} from "./iConfigurationService.ts";

/**
 * Пустая read-only заглушка `IConfigurationService` для юнитов, которым
 * настройки безразличны: все ключи возвращают переданный `defaultValue`
 * (дефолтов реестра у неё нет), `inspect()` отдаёт пустые слои, запись —
 * отказ. Где важны дефолты или запись, нужен `InMemoryConfigurationService`
 * (его же биндит тестовый профиль).
 */
export const NULL_CONFIGURATION_SERVICE: IConfigurationService = {
    get<T>(_key: string, defaultValue?: T): T | undefined {
        return defaultValue;
    },
    getValue(): unknown {
        return {};
    },
    getConfigurationData(): IConfigurationData {
        return { defaults: {}, user: {} };
    },
    inspect<T>(_key: string): IConfigurationInspectResult<T> {
        return { default: undefined, user: undefined, profile: undefined, value: undefined };
    },
    onDidChangeConfiguration(_listener: (event: IConfigurationChangeEvent) => void): IDisposable {
        return {
            dispose() {
                /* no-op */
            },
        };
    },
    updateValue(key: string, _value: unknown): Promise<void> {
        return Promise.reject(new Error(`NULL_CONFIGURATION_SERVICE is read-only: cannot write "${key}"`));
    },
};
