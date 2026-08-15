import type { IDisposable } from "@tuidom/core/common/disposable";

import type {
    IConfigurationChangeEvent,
    IConfigurationInspectResult,
    IConfigurationService,
} from "./iConfigurationService.ts";

/**
 * Заглушка `IConfigurationService` для тестов и сценариев, где настройки
 * не загружаются (CI, unit-тесты, demo). Все ключи возвращают переданный
 * `defaultValue`; `inspect()` отдаёт пустые слои.
 */
export const NULL_CONFIGURATION_SERVICE: IConfigurationService = {
    get<T>(_key: string, defaultValue?: T): T | undefined {
        return defaultValue;
    },
    getValue(): unknown {
        return {};
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
};
