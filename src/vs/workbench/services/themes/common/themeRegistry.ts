import type { IThemeFile } from "../../../../platform/theme/common/iThemeFile.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";

import { builtinThemes } from "./themes/builtinThemes.ts";

export interface IThemeDescriptor {
    readonly label: string;
    readonly type: "dark" | "light" | "hc" | "hcLight";
}

/**
 * Keyed by label (as stored in `workbench.colorTheme`). Extension themes register after the
 * built-ins, so a same-label extension theme shadows the built-in, as in VS Code.
 */
export class ThemeRegistry {
    private readonly themes = new Map<string, IThemeFile>();

    public constructor(initial: readonly IThemeFile[] = []) {
        for (const theme of initial) this.register(theme);
    }

    /** Nameless themes are ignored. */
    public register(theme: IThemeFile): void {
        if (theme.name === undefined) return;
        this.themes.set(theme.name, theme);
    }

    /** A shadowed theme is not restored: one entry per label. */
    public unregister(label: string): boolean {
        return this.themes.delete(label);
    }

    public has(label: string): boolean {
        return this.themes.has(label);
    }

    public getThemeFile(label: string): IThemeFile | undefined {
        return this.themes.get(label);
    }

    public list(): IThemeDescriptor[] {
        return [...this.themes.entries()].map(([label, theme]) => ({
            label,
            type: theme.type ?? "dark",
        }));
    }

    public resolve(label: string): WorkbenchTheme | undefined {
        const themeFile = this.themes.get(label);
        return themeFile === undefined ? undefined : WorkbenchTheme.fromThemeFile(themeFile);
    }
}

export function createBuiltinThemeRegistry(): ThemeRegistry {
    return new ThemeRegistry(builtinThemes);
}
