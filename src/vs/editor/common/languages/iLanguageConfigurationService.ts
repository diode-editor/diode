import { token } from "../../../platform/instantiation/common/diContainer.ts";

import { EMPTY_LANGUAGE_CONFIGURATION, type IResolvedLanguageConfiguration } from "./languageConfiguration.ts";

/**
 * Доступ к `language-configuration.json` языков (comments, brackets,
 * autoClosingPairs, surroundingPairs).
 *
 * Та же дисциплина, что у `ILanguageService`: интерфейс живёт в editor,
 * реализация — `workbench/services/language` (файл конфигурации приезжает из
 * расширения, и читать его умеют только верхние слои). Загрузка асинхронная
 * (чтение ассета), потребление — синхронное из кэша: команды (комментирование)
 * ждут {@link ensureLoaded} сами, а перехватчик набора (auto-closing) читает
 * {@link get} на каждом нажатии и не может ждать — владелец редактора обязан
 * прогреть язык заранее, как грамматики в `preloadGrammarsForFiles`.
 */
export interface ILanguageConfigurationService {
    /**
     * Конфигурация языка из кэша. `undefined` — язык ещё не загружен
     * ({@link ensureLoaded} не звали или она ещё в полёте); язык БЕЗ файла
     * конфигурации после загрузки отдаёт {@link EMPTY_LANGUAGE_CONFIGURATION},
     * а не `undefined` — потребитель различает «не готово» и «нет правил».
     */
    get(languageId: string): IResolvedLanguageConfiguration | undefined;

    /**
     * Загружает и кэширует конфигурацию языка. Повторные вызовы дешёвые
     * (один платёж за язык, ошибки тоже кэшируются). Никогда не реджектится:
     * битый или отсутствующий файл — это {@link EMPTY_LANGUAGE_CONFIGURATION}.
     */
    ensureLoaded(languageId: string): Promise<IResolvedLanguageConfiguration>;
}

export const LanguageConfigurationServiceDIToken = token<ILanguageConfigurationService>("LanguageConfigurationService");

/**
 * Заглушка для тестов и раннего bootstrap'а: у всех языков пустая
 * конфигурация — комментирование и авто-скобки выключены.
 */
export const NULL_LANGUAGE_CONFIGURATION_SERVICE: ILanguageConfigurationService = {
    get: () => EMPTY_LANGUAGE_CONFIGURATION,
    ensureLoaded: () => Promise.resolve(EMPTY_LANGUAGE_CONFIGURATION),
};
