/**
 * Контракт CJS-модуля расширения, как его ждёт `runExtensionHostSubprocess`.
 *
 * Сигнатура канонически совпадает с VS Code: `activate(context)`. Внутри
 * расширение получает API через `require("vscode")` — мы стабим этот модуль
 * в subprocess'е через `Module._cache` + `_resolveFilename` patch.
 */
export interface IExtensionEntry {
    activate(context: { readonly subscriptions: { dispose(): unknown }[] }): unknown;
    deactivate?(): unknown;
}

/**
 * Регистрация расширения в {@link ExtensionHost}. Два взаимоисключающих способа
 * загрузки модуля в subprocess (ровно один должен быть задан):
 *
 * - **`mainPath`** — абсолютный путь к файлу на ФС subprocess'а, грузится через
 *   `createRequire(mainPath)` (user-расширения; в dev — `.ts`/`.cjs` через tsx).
 * - **`source` + `filename`** — исходник CJS-модуля строкой, компилируется
 *   в памяти через `Module._compile` (builtin code-расширения: их скомпилированный
 *   `out/extension.cjs` читается из `IAssetAccess` и работает единообразно в dev
 *   и под SEA, где реального файла на ФС нет). `filename` — синтетический
 *   абсолютный путь (идентичность модуля / стек-трейсы); относительных `require`
 *   в бандле нет, поэтому он не резолвится по ФС.
 */
export interface IExtensionRegistration {
    readonly id: string;
    readonly manifest: {
        readonly name: string;
        readonly publisher: string;
        readonly version: string;
        readonly [key: string]: unknown;
    };
    /** Путь к модулю на ФС subprocess'а. Взаимоисключающе с `source`. */
    readonly mainPath?: string;
    /**
     * Корень установленного расширения на ФС — каталог `<extensionsDir>/
     * <publisher>.<name>-<version>` (user-vsix). Из него subprocess строит
     * `context.extensionPath` / `extensionUri` / `asAbsolutePath` — так
     * расширение находит свои ресурсы внутри установки (bundled language-сервер
     * basedpyright — `context.asAbsolutePath("dist/server.js")`). Для builtin'ов
     * из in-memory `source` отсутствует — subprocess возьмёт каталог `filename`.
     */
    readonly extensionPath?: string;
    /** Исходник CJS-модуля для in-memory загрузки. Требует `filename`. Взаимоисключающе с `mainPath`. */
    readonly source?: string;
    /** Синтетический абсолютный путь-идентичность для `source`. */
    readonly filename?: string;
    /**
     * Дефолты из `contributes.configuration` расширения, сплюснутые в dotted-map
     * (`{ "editorconfig.generateAuto": true }`). Отправляются в subprocess в
     * `host.activateExtension` и слоятся под пользовательским снапшотом настроек.
     */
    readonly configDefaults?: Readonly<Record<string, unknown>>;
    /**
     * Заголовки команд из `contributes.commands` (`{ "EditorConfig.generate":
     * "Generate .editorconfig" }`). Когда расширение регистрирует одноимённую
     * команду в рантайме, host заводит прокси с этим title — и команда
     * появляется в палитре.
     */
    readonly commandTitles?: Readonly<Record<string, string>>;
    /**
     * События активации из `manifest.activationEvents` (`["onLanguage:json",
     * "onStartupFinished"]`). {@link ExtensionHost.registerExtension} только
     * запоминает регистрацию; реальная активация (`host.activateExtension`)
     * происходит в {@link ExtensionHost.activateByEvent}, когда наступает
     * подходящее событие. Пусто/отсутствует ⇒ трактуется как `["*"]` (eager) —
     * сохраняет поведение расширений, не описавших события.
     */
    readonly activationEvents?: readonly string[];
}
