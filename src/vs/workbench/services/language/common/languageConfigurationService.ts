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

export interface ILanguageConfigurationPathSource {
    getLanguage(languageId: string): { readonly configurationPath: string | undefined } | undefined;
}

/**
 * The format is JSONC (stock files have comments and trailing commas), the parsing policy is as for
 * `settings.json`: errors go to the log, the partial result is used. The per-language cache is permanent, including
 * failures: there is no hot reload of contributions (`reloadWindow`). {@link register} layers work as
 * upstream `ComposedLanguageConfiguration`: a layer section replaces the file section entirely, the later
 * layer wins, and the merged result is what gets expanded (pairs are derived from the layer's brackets).
 */
export class LanguageConfigurationService implements ILanguageConfigurationService {
    /** Raw language file; `null` means loaded, but the file is missing or broken. */
    private readonly files = new Map<string, ILanguageConfiguration | null>();
    private readonly flights = new Map<string, Promise<IResolvedLanguageConfiguration>>();
    /** Extension layers per language, in registration order. */
    private readonly layers = new Map<string, ILanguageConfiguration[]>();
    /** Expanded configuration, cached until the language's layers change. */
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
        // toDisposable fires once, so the layer is still in the array.
        return toDisposable(() => {
            layers.splice(layers.indexOf(layer), 1);
            this.resolved.delete(languageId);
        });
    }

    public ensureLoaded(languageId: string): Promise<IResolvedLanguageConfiguration> {
        // One promise per language, even after settling: the asset is not fetched twice.
        let flight = this.flights.get(languageId);
        if (flight === undefined) {
            flight = this.load(languageId).then((file) => {
                // A layer may arrive before the file; get() merges them (no cache before the file).
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

/** Only the sections the layer sets: an `undefined` field must not overwrite the file section. */
function definedSections(layer: ILanguageConfiguration): ILanguageConfiguration {
    return Object.fromEntries(Object.entries(layer).filter(([, value]) => value !== undefined));
}
