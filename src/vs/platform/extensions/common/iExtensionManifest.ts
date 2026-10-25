import type { IGrammarContribution } from "./iGrammarContribution.ts";
import type { ILanguageContribution } from "./iLanguageContribution.ts";
import type { IThemeContribution } from "./iThemeContribution.ts";

/**
 * Extension manifest (`package.json`). Strings are already localized: `extensionNls.ts` substitutes
 * `"%key%"` keys during `scanExtensions`, so consumers don't resolve them.
 */
export interface IExtensionManifest {
    readonly name: string;

    readonly displayName?: string;

    readonly description?: string;

    readonly version: string;

    readonly publisher: string;

    /** Not validated. */
    readonly engines: {
        readonly vscode: string;
        readonly node?: string;
        /** For native diode extensions in the registry. */
        readonly diode?: string;
    };

    readonly main?: string;

    /** Not executed. */
    readonly browser?: string;

    /** `"module"` (unless `main` is `.cjs`) means the ESM loader, otherwise `require`; the rule is `isEsmEntry`. */
    readonly type?: "module" | "commonjs";

    readonly activationEvents?: readonly string[];

    /** Unused. */
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

    /** Flat keys and language sections (`"[makefile]": { "editor.insertSpaces": false }`). */
    readonly configurationDefaults?: Readonly<Record<string, unknown>>;

    /** Only `command`/`title`/`category` are read; other fields (`enablement`, …) are ignored. */
    readonly commands?: readonly ICommandContribution[];

    /** Platform-specific `mac`/`linux`/`win` and `args` are not applied yet. */
    readonly keybindings?: readonly IKeybindingContribution[];

    /** All are read at startup, before the first frame. */
    readonly themes?: readonly IThemeContribution[];

    /** An unknown menu id is a log line, not an extension failure. */
    readonly menus?: Readonly<Record<string, readonly IExtensionMenuItemContribution[]>>;

    readonly submenus?: readonly IExtensionSubmenuContribution[];

    readonly taskDefinitions?: readonly ITaskDefinitionContribution[];

    /**
     * Keyed by location: `activitybar` (our sidebar), `panel`, `secondarySidebar`. Foreign data — the
     * registrar (`api/browser/viewsExtensionPoint.ts`) validates it.
     */
    readonly viewsContainers?: Readonly<Record<string, readonly IViewContainerContribution[]>>;

    /**
     * Keyed by container: `explorer`, `scm` or an id from `viewsContainers`. Tree views get a section,
     * empty until the extension registers its tree (`window.createTreeView`).
     */
    readonly views?: Readonly<Record<string, readonly IViewContribution[]>>;

    /** Not strictly typed: the manifest is foreign data, the registrar validates it. */
    readonly semanticTokenTypes?: unknown;
    readonly semanticTokenModifiers?: unknown;
    readonly semanticTokenScopes?: unknown;

    readonly [key: string]: unknown;
}

/** Either `command` or `submenu`. */
export interface IExtensionMenuItemContribution {
    readonly command?: string;
    /** Defaults to the command title from the registry. */
    readonly title?: string;
    readonly submenu?: string;
    readonly when?: string;
    /** Without `@`, the order follows the position in the manifest. */
    readonly group?: string;
    /** Not rendered yet. */
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
    /** Label prefix in the command palette, not part of `title`. */
    readonly category?: string;
    /** Only a `"$(name)"` codicon is rendered; with an SVG path the item stays a label in the "⋯" menu. */
    readonly icon?: unknown;
    readonly [key: string]: unknown;
}

/** A leading `-` in `command` (`"-cmd"`) removes the binding, as in VS Code. */
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

/** `type` is `"tree"` (default) or `"webview"`. */
export interface IViewContribution {
    readonly id: string;
    readonly name?: string;
    readonly type?: string;
    /** The view exists only while the clause holds (re-evaluated on every context key change). */
    readonly when?: string;
    /** `visible` (default), `collapsed`; `hidden` is not supported yet and reads as `visible`. */
    readonly visibility?: string;
    readonly [key: string]: unknown;
}

/** Upstream requires all three; `icon` is checked but not drawn (the switcher lists titles). */
export interface IViewContainerContribution {
    readonly id: string;
    readonly title: string;
    readonly icon: string;
    readonly [key: string]: unknown;
}

export interface ITaskDefinitionContribution {
    readonly type?: string;
    readonly required?: readonly string[];
    readonly properties?: Readonly<Record<string, unknown>>;
    readonly when?: string;
}
