import type { IThemeFile } from "../../../../platform/theme/common/iThemeFile.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";

import { builtinThemes } from "./themes/builtinThemes.ts";

/** A theme entry as surfaced to the theme picker. */
export interface IThemeDescriptor {
    /** Display name / picker label (`IThemeFile.name`). */
    readonly label: string;
    /** Base theme type — used to group dark vs light in the picker. */
    readonly type: "dark" | "light" | "hc" | "hcLight";
}

/**
 * Registry of available color themes, keyed by display name (the label shown in
 * the theme picker and stored in the `workbench.colorTheme` setting).
 *
 * Mirrors VS Code's theme service: built-in themes are seeded here, and the
 * active theme is selected by label. Themes contributed by extensions
 * (`contributes.themes`) register into the same registry at startup
 * (`ExtensionThemeContributor`) — after the built-ins, so an extension theme
 * with a built-in label shadows it, as in VS Code.
 */
export class ThemeRegistry {
    private readonly themes = new Map<string, IThemeFile>();

    public constructor(initial: readonly IThemeFile[] = []) {
        for (const theme of initial) this.register(theme);
    }

    /**
     * Register a theme, keyed by its `name`. A later registration with the same
     * name replaces the earlier one (matching VS Code, where a user extension
     * can shadow a built-in theme). Themes without a `name` are ignored.
     */
    public register(theme: IThemeFile): void {
        if (theme.name === undefined) return;
        this.themes.set(theme.name, theme);
    }

    /**
     * Remove a theme by label. Returns whether one was registered. Backs
     * `ExtensionThemeContributor.dispose()` — a shadowed theme is not restored:
     * the registry keeps one entry per label.
     */
    public unregister(label: string): boolean {
        return this.themes.delete(label);
    }

    public has(label: string): boolean {
        return this.themes.has(label);
    }

    public getThemeFile(label: string): IThemeFile | undefined {
        return this.themes.get(label);
    }

    /** Descriptors for every registered theme, in registration order. */
    public list(): IThemeDescriptor[] {
        // Label comes from the map key (always the theme's `name` — `register`
        // skips nameless themes), so no fallback is needed here.
        return [...this.themes.entries()].map(([label, theme]) => ({
            label,
            type: theme.type ?? "dark",
        }));
    }

    /**
     * Resolve a theme label to a {@link WorkbenchTheme}, or `undefined` if no
     * theme with that label is registered.
     */
    public resolve(label: string): WorkbenchTheme | undefined {
        const themeFile = this.themes.get(label);
        return themeFile === undefined ? undefined : WorkbenchTheme.fromThemeFile(themeFile);
    }
}

/** A {@link ThemeRegistry} seeded with all built-in themes. */
export function createBuiltinThemeRegistry(): ThemeRegistry {
    return new ThemeRegistry(builtinThemes);
}
