import type { IDisposable } from "../../../base/common/lifecycle.ts";

import type {
    IConfigurationChangeEvent,
    IConfigurationData,
    IConfigurationInspectResult,
    IConfigurationOverrides,
    IConfigurationService,
} from "./iConfigurationService.ts";

/** Дефолтов реестра нет: все ключи — `undefined`. Где важны дефолты или запись — `InMemoryConfigurationService`. */
export const NULL_CONFIGURATION_SERVICE: IConfigurationService = {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T — приведение, как у IConfigurationService.get
    get<T>(_key: string, _overrides?: IConfigurationOverrides): T | undefined {
        return undefined;
    },
    getValue(): unknown {
        return {};
    },
    getConfigurationData(): IConfigurationData {
        return { defaults: {}, user: {}, workspace: {}, workspaceFolder: {} };
    },
    inspect<T>(_key: string): IConfigurationInspectResult<T> {
        return {
            default: undefined,
            user: undefined,
            profile: undefined,
            workspace: undefined,
            workspaceFolder: undefined,
            value: undefined,
        };
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
