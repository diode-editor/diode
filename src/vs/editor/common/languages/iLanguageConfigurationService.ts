import { Disposable, type IDisposable } from "../../../base/common/lifecycle.ts";
import type { ILanguageConfiguration } from "../../../platform/extensions/common/iLanguageConfiguration.ts";
import { token } from "../../../platform/instantiation/common/diContainer.ts";

import { EMPTY_LANGUAGE_CONFIGURATION, type IResolvedLanguageConfiguration } from "./languageConfiguration.ts";

/**
 * Загрузка асинхронная, потребление — синхронное из кэша: перехватчик набора
 * (auto-closing) читает {@link get} на каждом нажатии и ждать не может —
 * владелец редактора обязан прогреть язык заранее, как грамматики в
 * `preloadGrammarsForFiles`.
 */
export interface ILanguageConfigurationService {
    /**
     * `undefined` — ещё не загружен; язык БЕЗ файла конфигурации после загрузки
     * отдаёт {@link EMPTY_LANGUAGE_CONFIGURATION} — «не готово» ≠ «нет правил».
     */
    get(languageId: string): IResolvedLanguageConfiguration | undefined;

    /** Ошибки тоже кэшируются. Никогда не реджектится. */
    ensureLoaded(languageId: string): Promise<IResolvedLanguageConfiguration>;

    /**
     * `languages.setLanguageConfiguration`: заданные секции заменяют секции
     * файла целиком, поздний слой побеждает ранний — как `register` эталона.
     */
    register(languageId: string, configuration: ILanguageConfiguration): IDisposable;
}

export const LanguageConfigurationServiceDIToken = token<ILanguageConfigurationService>("LanguageConfigurationService");

export const NULL_LANGUAGE_CONFIGURATION_SERVICE: ILanguageConfigurationService = {
    get: () => EMPTY_LANGUAGE_CONFIGURATION,
    ensureLoaded: () => Promise.resolve(EMPTY_LANGUAGE_CONFIGURATION),
    register: () => Disposable.None,
};
