import { parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser";

import type { IAssetAccess } from "../../../../base/common/assets/iAssetAccess.ts";
import { type IDisposable, toDisposable } from "../../../../base/common/lifecycle.ts";
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
 *
 * Поверх файла лежат слои расширений ({@link register}): как у эталона
 * (`ComposedLanguageConfiguration`), секции сливаются по полю — заданная слоем
 * секция заменяет секцию файла целиком, поздний слой побеждает ранний, — и уже
 * результат разворачивается в {@link IResolvedLanguageConfiguration} (так пары
 * авто-закрытия выводятся из скобок слоя, если своих пар у него нет).
 */
export class LanguageConfigurationService implements ILanguageConfigurationService {
    /** Сырой файл языка; `null` — загружен, но файла нет или он битый. */
    private readonly files = new Map<string, ILanguageConfiguration | null>();
    private readonly flights = new Map<string, Promise<IResolvedLanguageConfiguration>>();
    /** Слои расширений по языку, в порядке регистрации. */
    private readonly layers = new Map<string, ILanguageConfiguration[]>();
    /** Развёрнутая конфигурация — кэш до смены слоёв языка. */
    private readonly resolved = new Map<string, IResolvedLanguageConfiguration>();

    public constructor(
        private readonly assets: IAssetAccess,
        private readonly languages: ILanguageConfigurationPathSource,
        private readonly logger: ILogger,
    ) {}

    public get(languageId: string): IResolvedLanguageConfiguration | undefined {
        const cached = this.resolved.get(languageId);
        if (cached !== undefined) return cached;
        const file = this.files.get(languageId);
        if (file === undefined) return undefined;
        const layers = this.layers.get(languageId) ?? [];
        const configuration =
            file === null && layers.length === 0
                ? EMPTY_LANGUAGE_CONFIGURATION
                : resolveLanguageConfiguration(
                      layers.reduce<ILanguageConfiguration>(
                          (merged, layer) => ({ ...merged, ...definedSections(layer) }),
                          file ?? {},
                      ),
                  );
        this.resolved.set(languageId, configuration);
        return configuration;
    }

    public register(languageId: string, configuration: ILanguageConfiguration): IDisposable {
        const layer = { ...configuration };
        let layers = this.layers.get(languageId);
        if (layers === undefined) {
            layers = [];
            this.layers.set(languageId, layers);
        }
        layers.push(layer);
        this.resolved.delete(languageId);
        // toDisposable срабатывает один раз — слой в массиве ещё есть.
        return toDisposable(() => {
            layers.splice(layers.indexOf(layer), 1);
            this.resolved.delete(languageId);
        });
    }

    public ensureLoaded(languageId: string): Promise<IResolvedLanguageConfiguration> {
        // Один промис на язык — и пока чтение в полёте, и после: повторный
        // вызов получает тот же settled-промис, к ассету никто не идёт второй
        // раз. Синхронный доступ к готовому значению — через {@link get}.
        let flight = this.flights.get(languageId);
        if (flight === undefined) {
            flight = this.load(languageId).then((file) => {
                // Слой мог прийти раньше файла — get() сливает их (до файла кэша нет).
                this.files.set(languageId, file);
                return this.get(languageId) ?? EMPTY_LANGUAGE_CONFIGURATION;
            });
            this.flights.set(languageId, flight);
        }
        return flight;
    }

    private async load(languageId: string): Promise<ILanguageConfiguration | null> {
        const configurationPath = this.languages.getLanguage(languageId)?.configurationPath;
        if (configurationPath === undefined) return null;

        let content: string;
        try {
            content = await this.assets.readText(configurationPath);
        } catch (err) {
            this.logger.warn(
                `language configuration for '${languageId}' unreadable at ${configurationPath}`,
                err instanceof Error ? err.message : err,
            );
            return null;
        }

        const errors: ParseError[] = [];
        const parsed: unknown = parseJsonc(content, errors, { allowTrailingComma: true });
        for (const err of errors) {
            this.logger.warn(
                `JSONC parse error in ${configurationPath} at offset ${String(err.offset)}: ${printParseErrorCode(err.error)}`,
            );
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            return null;
        }
        return parsed as ILanguageConfiguration;
    }
}

/** Только заданные секции слоя: `undefined`-поле не должно затирать секцию файла. */
function definedSections(layer: ILanguageConfiguration): ILanguageConfiguration {
    return Object.fromEntries(Object.entries(layer).filter(([, value]) => value !== undefined));
}
