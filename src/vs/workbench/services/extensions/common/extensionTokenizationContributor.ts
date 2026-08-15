import type { IDisposable } from "@tuidom/core/common/disposable";
import { joinVirtualPath } from "../../../../base/common/assets/assetBundleFormat.ts";
import type { IAssetAccess } from "../../../../base/common/assets/iAssetAccess.ts";
import type { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { IGrammarRecord } from "../../textMate/common/textMateGrammarLoader.ts";
import { TextMateGrammarLoader } from "../../textMate/common/textMateGrammarLoader.ts";

/**
 * Применяет вклад расширений в подсветку синтаксиса:
 *   - собирает {@link IGrammarRecord}[] из всех `contributes.grammars`,
 *   - создаёт общий {@link TextMateGrammarLoader},
 *   - для каждой грамматики с привязанным `language` регистрирует в
 *     {@link TokenizationRegistry} **ленивую фабрику** support'а.
 *
 * `.tmLanguage.json` не читается и не парсится, пока язык не понадобится:
 * грамматика грузится при первом `TokenizationRegistry.load(languageId)`
 * (его дёргает редактор, открывший документ на этом языке), а остальные —
 * фоновым {@link preloadAll} уже после первого кадра. Все 77 builtin-грамматик
 * — это 6.6 MB JSON, парсить их на старте ради одного открытого файла незачем.
 *
 * Injection-грамматики (без `language`) только добавляются в loader —
 * vscode-textmate сам подмешает их в хост-грамматики через `getInjections`.
 *
 * Возвращает Disposable, который убирает все регистрации (для будущей
 * выгрузки расширений). Внутри хранит созданный loader, чтобы освободить
 * vscode-textmate Registry при dispose.
 */
export class ExtensionTokenizationContributor implements IDisposable {
    private readonly assets: IAssetAccess;
    private readonly extensions: readonly IExtension[];
    private readonly tokenizationRegistry: TokenizationRegistry;
    private readonly logger: ILogger | undefined;
    private loader: TextMateGrammarLoader | undefined;
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

    /**
     * Регистрирует ленивые фабрики грамматик в `TokenizationRegistry`.
     * Синхронный и без I/O: конструктор {@link TextMateGrammarLoader} только
     * заполняет свои Map'ы, файлы читаются уже внутри фабрик.
     */
    public apply(): void {
        const records = this.collectGrammarRecords();
        if (records.length === 0) return;

        const loader = new TextMateGrammarLoader(this.assets, records);
        this.loader = loader;

        for (const grammar of this.iterAllGrammars()) {
            if (grammar.language === undefined) continue;
            const languageId = grammar.language;
            const scopeName = grammar.scopeName;
            this.registrationDisposables.push(
                // Фабрика не может стартовать после dispose(): он снимает
                // lazy-записи из реестра, и load() до неё уже не доходит.
                // Флаг disposed нужен только для in-flight-случая ниже.
                this.tokenizationRegistry.registerLazy(languageId, async () => {
                    try {
                        const support = await loader.loadSupport(scopeName);
                        if (support === null) {
                            this.logger?.error(`Failed to load grammar "${scopeName}" for language "${languageId}"`);
                            return null;
                        }
                        return support;
                    } catch (err) {
                        // dispose() роняет vscode-textmate Registry под in-flight
                        // loadGrammar — это ожидаемо, в лог сыпать не надо.
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
     * Догружает в фоне все ещё не тронутые грамматики, чтобы переключение
     * вкладки на другой язык не ждало парсинга. Вызывать только после первого
     * кадра — это тёплый прогрев, а не часть старта.
     *
     * Последовательно, а не `Promise.all`: `JSON.parse` синхронен, и пачка
     * параллельных загрузок слилась бы в один блокирующий бёрст. `await` между
     * языками отдаёт event loop, так что ввод остаётся живым.
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
