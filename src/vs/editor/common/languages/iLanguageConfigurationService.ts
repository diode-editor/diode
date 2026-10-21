import { Disposable, type IDisposable } from "../../../base/common/lifecycle.ts";
import type { ILanguageConfiguration } from "../../../platform/extensions/common/iLanguageConfiguration.ts";
import { token } from "../../../platform/instantiation/common/diContainer.ts";

import { EMPTY_LANGUAGE_CONFIGURATION, type IResolvedLanguageConfiguration } from "./languageConfiguration.ts";

/**
 * Loading is async, consumption is synchronous from the cache: the typing interceptor
 * (auto-closing) reads {@link get} on every keystroke and cannot wait, so the editor
 * owner must warm up the language in advance, like grammars in
 * `preloadGrammarsForFiles`.
 */
export interface ILanguageConfigurationService {
    /**
     * `undefined`: not loaded yet. A language WITHOUT a configuration file returns
     * {@link EMPTY_LANGUAGE_CONFIGURATION} once loaded: "not ready" ≠ "no rules".
     */
    get(languageId: string): IResolvedLanguageConfiguration | undefined;

    /** Errors are cached too. Never rejects. */
    ensureLoaded(languageId: string): Promise<IResolvedLanguageConfiguration>;

    /**
     * `languages.setLanguageConfiguration`: given sections replace the file's sections
     * entirely, a later layer wins over an earlier one, like upstream `register`.
     */
    register(languageId: string, configuration: ILanguageConfiguration): IDisposable;
}

export const LanguageConfigurationServiceDIToken = token<ILanguageConfigurationService>("LanguageConfigurationService");

export const NULL_LANGUAGE_CONFIGURATION_SERVICE: ILanguageConfigurationService = {
    get: () => EMPTY_LANGUAGE_CONFIGURATION,
    ensureLoaded: () => Promise.resolve(EMPTY_LANGUAGE_CONFIGURATION),
    register: () => Disposable.None,
};
