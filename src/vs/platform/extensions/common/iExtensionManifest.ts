import type { IGrammarContribution } from "./iGrammarContribution.ts";
import type { ILanguageContribution } from "./iLanguageContribution.ts";
import type { IThemeContribution } from "./iThemeContribution.ts";

/**
 * Манифест расширения (`package.json`). Строки уже локализованы: ключи
 * `"%key%"` подменяет `extensionNls.ts` при `scanExtensions`, потребителю
 * резолвить не надо.
 */
export interface IExtensionManifest {
    readonly name: string;

    readonly displayName?: string;

    readonly description?: string;

    readonly version: string;

    readonly publisher: string;

    /** Не валидируется. */
    readonly engines: {
        readonly vscode: string;
        readonly node?: string;
        /** Для нативных diode-расширений в реестре. */
        readonly diode?: string;
    };

    readonly main?: string;

    /** Не исполняется. */
    readonly browser?: string;

    /** `"module"` (при `main` не `.cjs`) — ESM-loader, иначе `require`; правило — `isEsmEntry`. */
    readonly type?: "module" | "commonjs";

    readonly activationEvents?: readonly string[];

    /** Не используется. */
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

    readonly [key: string]: unknown;
}

export interface IExtensionContributions {
    readonly languages?: readonly ILanguageContribution[];
    readonly grammars?: readonly IGrammarContribution[];

    readonly configuration?: IConfigurationContribution | readonly IConfigurationContribution[];

    /** Плоские ключи и секции языков (`"[makefile]": { "editor.insertSpaces": false }`). */
    readonly configurationDefaults?: Readonly<Record<string, unknown>>;

    /** Из полей берутся `command`/`title`/`category`, прочие (`enablement`, …) игнорируются. */
    readonly commands?: readonly ICommandContribution[];

    /** Платформенные `mac`/`linux`/`win` и `args` пока не применяются. */
    readonly keybindings?: readonly IKeybindingContribution[];

    /** Читаются на старте все, до первого кадра. */
    readonly themes?: readonly IThemeContribution[];

    /** Неизвестная точка меню — строка в лог, а не падение расширения. */
    readonly menus?: Readonly<Record<string, readonly IExtensionMenuItemContribution[]>>;

    readonly submenus?: readonly IExtensionSubmenuContribution[];

    readonly taskDefinitions?: readonly ITaskDefinitionContribution[];

    /** Виды пока не рисуются (docs/TODO/Extensions.md) — берётся только команда `<id>.focus`. */
    readonly views?: Readonly<Record<string, readonly IViewContribution[]>>;

    // ── TODO(extensions phase 2+): раскомментировать по мере реализации ──
    //
    // readonly iconThemes?: readonly IIconThemeContribution[];
    // readonly productIconThemes?: readonly IProductIconThemeContribution[];
    //
    // readonly snippets?: readonly ISnippetContribution[];
    //
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
    /** Не типизированы строго: манифест — чужие данные, валидирует регистратор. */
    readonly semanticTokenTypes?: unknown;
    readonly semanticTokenModifiers?: unknown;
    readonly semanticTokenScopes?: unknown;
    //
    // readonly typescriptServerPlugins?: readonly ITypescriptServerPluginContribution[];
    // readonly htmlLanguageParticipants?: readonly IHtmlLanguageParticipantContribution[];

    readonly [key: string]: unknown;
}

/** Либо `command`, либо `submenu`. */
export interface IExtensionMenuItemContribution {
    readonly command?: string;
    /** Без него — титул команды из реестра. */
    readonly title?: string;
    readonly submenu?: string;
    readonly when?: string;
    /** Без `@` — порядок по месту в манифесте. */
    readonly group?: string;
    /** Пока не рисуется. */
    readonly alt?: string;
    readonly [key: string]: unknown;
}

export interface IExtensionSubmenuContribution {
    readonly id: string;
    readonly label: string;
    readonly icon?: unknown;
    readonly [key: string]: unknown;
}

export interface ICommandContribution {
    readonly command: string;
    readonly title: string;
    /** Префикс подписи в палитре, но не часть `title`. */
    readonly category?: string;
    /** Рисуется только codicon `"$(имя)"`; с путём к SVG пункт остаётся подписью в «⋯». */
    readonly icon?: unknown;
    readonly [key: string]: unknown;
}

/** Ведущий `-` в `command` (`"-cmd"`) снимает привязку, как в VS Code. */
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

/** `type` — `"tree"` (по умолчанию) или `"webview"`. */
export interface IViewContribution {
    readonly id: string;
    readonly name?: string;
    readonly type?: string;
    readonly when?: string;
    readonly [key: string]: unknown;
}

export interface ITaskDefinitionContribution {
    readonly type?: string;
    readonly required?: readonly string[];
    readonly properties?: Readonly<Record<string, unknown>>;
    readonly when?: string;
}
