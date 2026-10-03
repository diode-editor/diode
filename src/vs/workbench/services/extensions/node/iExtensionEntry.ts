import * as path from "node:path";

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
     * Заголовки команд из `contributes.commands` (`{ "EditorConfig.generate":
     * "Generate .editorconfig" }`). Когда расширение регистрирует одноимённую
     * команду в рантайме, host заводит прокси с этим title — и команда
     * появляется в палитре.
     */
    readonly commandTitles?: Readonly<Record<string, string>>;
    /**
     * Группы команд из `contributes.commands` (`{ "java.clean.workspace":
     * "Java" }`) — те же id, что у {@link commandTitles}, но только для команд,
     * объявивших `category`. В палитре категория становится префиксом подписи
     * («Java: Clean Workspace»); в сам заголовок она не входит, иначе протекла
     * бы в меню и в статус-бар.
     */
    readonly commandCategories?: Readonly<Record<string, string>>;
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

/**
 * Корень расширения на ФС — `ExtensionContext.extensionPath`/`extensionUri` и
 * `Extension.extensionPath` из `vscode.extensions`. Правило одно на обе стороны
 * RPC (хост считает его для каталога, субпроцесс — для контекста активации),
 * поэтому живёт здесь, а не двумя копиями.
 *
 * У user-vsix это каталог установки (`extensionPath`). У builtin'а, который
 * грузится из in-memory `source`, каталога нет — берём каталог синтетического
 * `filename`: указывает «в бандл», что честнее выдуманного пути.
 */
export function extensionRootPath(spec: {
    readonly extensionPath?: string;
    readonly mainPath?: string;
    readonly filename?: string;
}): string {
    /* v8 ignore next -- одно из двух есть всегда: без mainPath и без filename расширение не загрузилось бы */
    // Stryker disable next-line StringLiteral: хвостовой `?? ""` недостижим по тому же инварианту, что и v8 ignore выше — тронуть его мутантом нечем
    return spec.extensionPath ?? path.dirname(spec.mainPath ?? spec.filename ?? "");
}
