import type { IDisposable } from "../../../base/common/lifecycle.ts";

import type {
    IConfigurationChangeEvent,
    IConfigurationData,
    IConfigurationInspectResult,
    IConfigurationOverrides,
    IConfigurationService,
} from "./iConfigurationService.ts";

/**
 * Пустая read-only заглушка `IConfigurationService` для юнитов, которым
 * настройки безразличны: все ключи отвечают `undefined` (дефолтов реестра у
 * неё нет), `inspect()` отдаёт пустые слои, запись —
 * отказ. Где важны дефолты или запись, нужен `InMemoryConfigurationService`
 * (его же биндит тестовый профиль).
 */
export const NULL_CONFIGURATION_SERVICE: IConfigurationService = {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T — приведение, как у IConfigurationService.get
    get<T>(_key: string, _overrides?: IConfigurationOverrides): T | undefined {
        return undefined;
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
