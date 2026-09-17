import { parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser";

import type { IAssetAccess } from "../../../../base/common/assets/iAssetAccess.ts";
import type { ILanguageConfigurationService } from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import {
    EMPTY_LANGUAGE_CONFIGURATION,
    type IResolvedLanguageConfiguration,
    resolveLanguageConfiguration,
} from "../../../../editor/common/languages/languageConfiguration.ts";
import type { ILanguageConfiguration } from "../../../../platform/extensions/common/iLanguageConfiguration.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

/**
 * Узкий порт к `LanguageRegistry`: сервису конфигураций от реестра нужен
 * только виртуальный путь к `language-configuration.json` языка.
 */
export interface ILanguageConfigurationPathSource {
    getLanguage(languageId: string): { readonly configurationPath: string | undefined } | undefined;
}

/**
 * Загрузка/парсинг/кэш `language-configuration.json` по языку.
 *
 * Файл конфигурации адресуется виртуальным путём из манифеста расширения
 * (`ILanguageEntry.configurationPath`) и читается через {@link IAssetAccess} —
 * то же адресное пространство, что у грамматик. Формат — JSONC: реальные
 * файлы стоковых расширений содержат комментарии и висячие запятые, политика
 * разбора та же, что у `settings.json` (ошибки — в лог, частичный результат —
 * в дело).
 *
 * Кэш — по языку и навсегда (расширения сканируются один раз на старте,
 * горячей перезагрузки вкладов нет — см. `reloadWindow`). Кэшируются и
 * неудачи: язык без файла, нечитаемый ассет и не-объект после парсинга дают
 * {@link EMPTY_LANGUAGE_CONFIGURATION}, второй раз к диску никто не идёт.
 */
export class LanguageConfigurationService implements ILanguageConfigurationService {
    private readonly resolved = new Map<string, IResolvedLanguageConfiguration>();
    private readonly flights = new Map<string, Promise<IResolvedLanguageConfiguration>>();

    public constructor(
        private readonly assets: IAssetAccess,
        private readonly languages: ILanguageConfigurationPathSource,
        private readonly logger: ILogger,
    ) {}

    public get(languageId: string): IResolvedLanguageConfiguration | undefined {
        return this.resolved.get(languageId);
    }

    public ensureLoaded(languageId: string): Promise<IResolvedLanguageConfiguration> {
        // Один промис на язык — и пока чтение в полёте, и после: повторный
        // вызов получает тот же settled-промис, к ассету никто не идёт второй
        // раз. Синхронный доступ к готовому значению — через {@link get}.
        let flight = this.flights.get(languageId);
        if (flight === undefined) {
            flight = this.load(languageId).then((configuration) => {
                this.resolved.set(languageId, configuration);
                return configuration;
            });
            this.flights.set(languageId, flight);
        }
        return flight;
    }

    private async load(languageId: string): Promise<IResolvedLanguageConfiguration> {
        const configurationPath = this.languages.getLanguage(languageId)?.configurationPath;
        if (configurationPath === undefined) return EMPTY_LANGUAGE_CONFIGURATION;

        let content: string;
        try {
            content = await this.assets.readText(configurationPath);
        } catch (err) {
            this.logger.warn(
                `language configuration for '${languageId}' unreadable at ${configurationPath}`,
                err instanceof Error ? err.message : err,
            );
            return EMPTY_LANGUAGE_CONFIGURATION;
        }

        const errors: ParseError[] = [];
        const parsed: unknown = parseJsonc(content, errors, { allowTrailingComma: true });
        for (const err of errors) {
            this.logger.warn(
                `JSONC parse error in ${configurationPath} at offset ${String(err.offset)}: ${printParseErrorCode(err.error)}`,
            );
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            return EMPTY_LANGUAGE_CONFIGURATION;
        }
        return resolveLanguageConfiguration(parsed as ILanguageConfiguration);
    }
}
