import { joinVirtualPath } from "../../../../base/common/assets/assetBundleFormat.ts";
import type { IAssetAccess } from "../../../../base/common/assets/iAssetAccess.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { IGrammarRecord } from "../../textMate/common/textMateGrammarLoader.ts";
import { TextMateGrammarLoader } from "../../textMate/common/textMateGrammarLoader.ts";
import type { ITextMateTheme } from "../../themes/common/textMateTheme.ts";
import { equalsTextMateTheme } from "../../themes/common/textMateTheme.ts";

/**
 * A grammar is parsed lazily on the first `TokenizationRegistry.load(languageId)`, the rest by the
 * background {@link preloadAll}: 77 builtin grammars are 6.6 MB of JSON.
 */
export class ExtensionTokenizationContributor implements IDisposable {
    private readonly assets: IAssetAccess;
    private readonly extensions: readonly IExtension[];
    private readonly tokenizationRegistry: TokenizationRegistry;
    private readonly logger: ILogger | undefined;
    private loader: TextMateGrammarLoader | undefined;
    private theme: ITextMateTheme | undefined;
    private registrationDisposables: IDisposable[] = [];
    private disposed = false;

    public constructor(
        assets: IAssetAccess,
        extensions: readonly IExtension[],
        tokenizationRegistry: TokenizationRegistry,
        logger?: ILogger,
    ) {
        this.assets = assets;
        this.extensions = extensions;
        this.tokenizationRegistry = tokenizationRegistry;
        this.logger = logger;
    }

    public apply(): void {
        const records = this.collectGrammarRecords();
        if (records.length === 0) return;

        const loader = new TextMateGrammarLoader(this.assets, records);
        this.loader = loader;
        if (this.theme !== undefined) loader.setTheme(this.theme);

        for (const grammar of this.iterAllGrammars()) {
            if (grammar.language === undefined) continue;
            const languageId = grammar.language;
            const scopeName = grammar.scopeName;
            this.registrationDisposables.push(
                this.tokenizationRegistry.registerLazy(languageId, async () => {
                    try {
                        const support = await loader.loadSupport(scopeName);
                        if (support === null) {
                            this.logger?.error(`Failed to load grammar "${scopeName}" for language "${languageId}"`);
                            return null;
                        }
                        return support;
                    } catch (err) {
                        // dispose() kills the Registry under an in-flight loadGrammar; expected, not logged.
                        if (!this.disposed) {
                            this.logger?.error(`Error loading grammar "${scopeName}" (${languageId})`, err);
                        }
                        return null;
                    }
                }),
            );
        }
    }

    /**
     * Like upstream `TextMateTokenizationFeature._updateTheme`. Same theme: do nothing,
     * retokenizing a large file isn't free.
     */
    public setTheme(theme: ITextMateTheme): void {
        if (equalsTextMateTheme(this.theme, theme)) return;
        this.theme = theme;
        this.loader?.setTheme(theme);
        this.tokenizationRegistry.setColorMap(theme.colorMap);
    }

    /**
     * Only after the first frame. Sequential rather than `Promise.all`: `JSON.parse` is synchronous,
     * and the `await` between languages yields the event loop to input.
     */
    public async preloadAll(): Promise<void> {
        for (const languageId of this.tokenizationRegistry.lazyLanguageIds()) {
            if (this.disposed) return;
            await this.tokenizationRegistry.load(languageId);
        }
    }

    public dispose(): void {
        this.disposed = true;
        for (const d of this.registrationDisposables) d.dispose();
        this.registrationDisposables = [];
        this.loader?.dispose();
        this.loader = undefined;
    }

    private collectGrammarRecords(): IGrammarRecord[] {
        const records: IGrammarRecord[] = [];
        for (const ext of this.extensions) {
            const grammars = ext.manifest.contributes?.grammars;
            if (grammars === undefined) continue;
            for (const grammar of grammars) {
                records.push({
                    scopeName: grammar.scopeName,
                    path: joinVirtualPath(ext.location, grammar.path),
                    injections: grammar.injectTo,
                });
            }
        }
        return records;
    }

    private *iterAllGrammars() {
        for (const ext of this.extensions) {
            const grammars = ext.manifest.contributes?.grammars;
            if (grammars === undefined) continue;
            for (const grammar of grammars) yield grammar;
        }
    }
}
