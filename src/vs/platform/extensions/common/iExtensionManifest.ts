import type { IGrammarContribution } from "./iGrammarContribution.ts";
import type { ILanguageContribution } from "./iLanguageContribution.ts";
import type { IThemeContribution } from "./iThemeContribution.ts";

/**
 * Полный VS Code-совместимый extension manifest (`package.json` расширения).
 *
 * Декларативно читаются {@link IExtensionContributions.languages},
 * {@link IExtensionContributions.grammars} и {@link IExtensionContributions.themes}
 * (плюс configuration/commands/keybindings). Остальные contributes-блоки
 * объявлены ниже как **закомментированные** TS-типы — они задокументированы,
 * но не активны, чтобы расширения, копируемые из VS Code, не падали по
 * типам, и чтобы было ясно, какие поля будут добавлены в будущем.
 *
 * **Локализация.** Любая строка манифеста может быть ключом `"%key%"` —
 * человеческий текст лежит в `package.nls[.<locale>].json`. Манифест, который
 * видят потребители, уже резолвнут: подмену одним проходом по дереву делает
 * `extensionNls.ts` на этапе `scanExtensions`. То есть `title` ниже — строка, а
 * не ключ, и приклеивать резолв у себя потребителю не надо.
 */
export interface IExtensionManifest {
    /** Технический id (нижний регистр, без пробелов). */
    readonly name: string;

    /** Локализуемое отображаемое имя (`"%displayName%"` или строка). */
    readonly displayName?: string;

    /** Локализуемое описание. */
    readonly description?: string;

    /** Semver. */
    readonly version: string;

    /** Издатель. Пара `publisher.name` формирует extension id. */
    readonly publisher: string;

    /** Engine compatibility. Phase 1: не валидируется. */
    readonly engines: {
        readonly vscode: string;
        readonly node?: string;
        /** Диапазон совместимых версий Diode (для нативных diode-расширений в реестре). */
        readonly diode?: string;
    };

    /**
     * Точка входа — JS-модуль, исполняемый Extension Host'ом.
     * **Phase 1: НЕ исполняется.** Все contributions декларативные.
     */
    readonly main?: string;

    /** Браузерный entry point. Phase 1: не исполняется. */
    readonly browser?: string;

    /**
     * Модульная система точки входа — обычное поле npm-пакета (`"module"` или
     * `"commonjs"`). Решает, как extension host грузит {@link main}: `"module"`
     * (при `main` без расширения `.cjs`) — настоящим ESM-loader'ом, иначе
     * `require`. Правило целиком — `isEsmEntry` в `extensionHostSubprocess.ts`;
     * ESM-расширения не экзотика (`esbenp.prettier-vscode` с 12.x).
     */
    readonly type?: "module" | "commonjs";

    /**
     * События активации (`onLanguage:typescript`, `onCommand:foo`, `*`, ...).
     * Phase 1: lazy activation отсутствует, всё активно сразу.
     */
    readonly activationEvents?: readonly string[];

    /** "ui" | "workspace" — где может работать. Не используется. */
    readonly extensionKind?: readonly ("ui" | "workspace" | "web")[];

    readonly extensionDependencies?: readonly string[];
    readonly extensionPack?: readonly string[];

    readonly contributes?: IExtensionContributions;

    readonly repository?: {
        readonly type: string;
        readonly url: string;
    };

    readonly categories?: readonly string[];
    readonly keywords?: readonly string[];
    readonly icon?: string;
    readonly license?: string;
    readonly author?: string | { readonly name: string };
    readonly homepage?: string;
    readonly bugs?: string | { readonly url?: string; readonly email?: string };

    /**
     * Произвольные поля типа `scripts`, `dependencies`, `devDependencies`
     * из обычного `package.json`. Игнорируются нашим loader'ом, но не должны
     * ломать парсинг.
     */
    readonly [key: string]: unknown;
}

/**
 * Все contributes из VS Code. **Активны `languages`, `grammars`, `themes`,
 * `configuration`, `commands` и `keybindings`.** Остальные блоки оставлены
 * закомментированными типами для будущих фаз.
 */
export interface IExtensionContributions {
    readonly languages?: readonly ILanguageContribution[];
    readonly grammars?: readonly IGrammarContribution[];

    /**
     * Вклад настроек. Ключи регистрирует в общем `ConfigurationRegistry`
     * `ExtensionConfigurationContributor` (на bootstrap, для всех расширений):
     * их дефолты видят ядро, валидатор settings.json и `getConfiguration()` в
     * subprocess.
     */
    readonly configuration?: IConfigurationContribution | readonly IConfigurationContribution[];

    /**
     * Переопределения дефолтов: плоские ключи и секции языков
     * (`"[makefile]": { "editor.insertSpaces": false }`). Ложатся в общий
     * реестр настроек переопределениями дефолтов (`registerDefaultConfigurations`).
     */
    readonly configurationDefaults?: Readonly<Record<string, unknown>>;

    /**
     * Команды расширения. Используем `command`/`title`/`category`: заголовок и
     * группа прокидываются в host, чтобы рантайм-`registerCommand` показался в
     * палитре (см. `IExtensionRegistration.commandTitles` /
     * `commandCategories`), а подпись выглядела как «Java: Clean Workspace».
     * Остальные поля (`icon`, `enablement`, …) пока игнорируются.
     */
    readonly commands?: readonly ICommandContribution[];

    /**
     * Клавиатурные привязки расширения. Регистрируются в `KeybindingRegistry`
     * (см. `main.ts`): `key` парсится как аккорд, `when` — как typed-контекст.
     * Платформенные оверрайды (`mac`/`linux`/`win`) и `args` пока не применяются.
     */
    readonly keybindings?: readonly IKeybindingContribution[];

    /**
     * Цветовые темы расширения. Файлы тем читаются на старте — все, до первого
     * кадра — и регистрируются в `ThemeRegistry` по `label`
     * (`ExtensionThemeContributor`, см. docs/TODO/Theming.md).
     */
    readonly themes?: readonly IThemeContribution[];

    /**
     * Пункты меню расширения: `"editor/context"` → список пунктов. Строковые id
     * VS Code переводит в наши `MenuId` мост
     * `registerExtensionMenus` (`services/extensions/common/extensionMenuContributor.ts`);
     * неизвестная точка — строка в лог, а не падение расширения.
     */
    readonly menus?: Readonly<Record<string, readonly IExtensionMenuItemContribution[]>>;

    /**
     * Объявления собственных подменю расширения (`contributes.submenus`): на
     * них ссылаются пункты `menus` полем `submenu`.
     */
    readonly submenus?: readonly IExtensionSubmenuContribution[];

    /**
     * Типы задач расширения (`contributes.taskDefinitions`): схема определения
     * задачи типа — по ней ядро считает ключ задачи провайдера — и неявное
     * событие активации `onTaskType:<type>`.
     */
    readonly taskDefinitions?: readonly ITaskDefinitionContribution[];

    // ── TODO(extensions phase 2+): раскомментировать по мере реализации ──
    //
    // readonly iconThemes?: readonly IIconThemeContribution[];
    // readonly productIconThemes?: readonly IProductIconThemeContribution[];
    //
    // readonly snippets?: readonly ISnippetContribution[];
    //
    // readonly views?: Readonly<Record<string, readonly IViewContribution[]>>;
    // readonly viewsContainers?: Readonly<Record<string, readonly IViewContainerContribution[]>>;
    // readonly viewsWelcome?: readonly IViewWelcomeContribution[];
    //
    // readonly colors?: readonly IColorContribution[];
    //
    // readonly debuggers?: readonly IDebuggerContribution[];
    // readonly breakpoints?: readonly IBreakpointContribution[];
    // readonly problemMatchers?: readonly IProblemMatcherContribution[];
    // readonly problemPatterns?: readonly IProblemPatternContribution[];
    //
    // readonly jsonValidation?: readonly IJsonValidationContribution[];
    //
    // readonly terminal?: ITerminalContribution;
    // readonly walkthroughs?: readonly IWalkthroughContribution[];
    //
    // readonly notebooks?: readonly INotebookContribution[];
    // readonly notebookRenderer?: readonly INotebookRendererContribution[];
    //
    // readonly customEditors?: readonly ICustomEditorContribution[];
    // readonly authentication?: readonly IAuthenticationContribution[];
    // readonly resourceLabelFormatters?: readonly IResourceLabelFormatterContribution[];
    //
    // readonly semanticTokenScopes?: readonly ISemanticTokenScopeContribution[];
    // readonly semanticTokenTypes?: readonly ISemanticTokenTypeContribution[];
    // readonly semanticTokenModifiers?: readonly ISemanticTokenModifierContribution[];
    //
    // readonly typescriptServerPlugins?: readonly ITypescriptServerPluginContribution[];
    // readonly htmlLanguageParticipants?: readonly IHtmlLanguageParticipantContribution[];

    /** Расширения VS Code иногда содержат поля, неизвестные нам. Игнорируем. */
    readonly [key: string]: unknown;
}

/**
 * Элемент `contributes.commands`. Нас интересуют `command` (id), `title` и
 * `category` для показа в палитре; остальные поля пока игнорируются.
 *
 * `title`/`category` приезжают уже локализованными (см. шапку файла).
 */
/**
 * Пункт меню из манифеста (VS Code `contributes.menus[<menuId>][]`). Либо
 * команда (`command`), либо ссылка на собственное подменю (`submenu`).
 */
export interface IExtensionMenuItemContribution {
    readonly command?: string;
    /** Свой label пункта в этой точке; без него — титул команды из реестра. */
    readonly title?: string;
    /** Id подменю из `contributes.submenus` — вместо команды. */
    readonly submenu?: string;
    /** Условие видимости через контекст-ключи. */
    readonly when?: string;
    /** `"группа@порядок"` (`"navigation@2"`); без `@` — порядок по месту в манифесте. */
    readonly group?: string;
    /** Альтернативная команда (Alt у пункта); у нас пока не рисуется. */
    readonly alt?: string;
    readonly [key: string]: unknown;
}

/** Объявление подменю расширения (VS Code `contributes.submenus[]`). */
export interface IExtensionSubmenuContribution {
    readonly id: string;
    readonly label: string;
    readonly icon?: unknown;
    readonly [key: string]: unknown;
}

export interface ICommandContribution {
    readonly command: string;
    readonly title: string;
    /** Группа команды (`"Java"`) — префикс подписи в палитре, но не часть `title`. */
    readonly category?: string;
    readonly [key: string]: unknown;
}

/**
 * Элемент `contributes.keybindings`. `key` — кросс-платформенный аккорд
 * (`"ctrl+m ctrl+r"`); `command` — id команды (extension- или builtin-команды);
 * `when` — when-выражение доступности. Ведущий `-` в `command` (`"-cmd"`)
 * снимает привязку, как в VS Code. Платформенные `mac`/`linux`/`win` и `args`
 * пока не применяются.
 */
export interface IKeybindingContribution {
    readonly command: string;
    readonly key: string;
    readonly mac?: string;
    readonly linux?: string;
    readonly win?: string;
    readonly when?: string;
    readonly args?: unknown;
    readonly [key: string]: unknown;
}

/**
 * Блок `contributes.configuration` (одиночный или в массиве). Нас интересуют
 * только `properties[*].default` — они формируют дефолтный слой конфигурации.
 */
export interface IConfigurationContribution {
    readonly title?: string;
    readonly order?: number;
    readonly properties?: Readonly<Record<string, IConfigurationPropertySchema>>;
    readonly [key: string]: unknown;
}

export interface IConfigurationPropertySchema {
    readonly type?: string | readonly string[];
    readonly default?: unknown;
    readonly description?: string;
    readonly [key: string]: unknown;
}

/** Тип задачи из `contributes.taskDefinitions` (`ITaskDefinition` схемы эталона). */
export interface ITaskDefinitionContribution {
    readonly type?: string;
    readonly required?: readonly string[];
    readonly properties?: Readonly<Record<string, unknown>>;
    readonly when?: string;
}
