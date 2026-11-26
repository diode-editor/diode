import type { IColorDefaults, IColorDefinition } from "../../../../platform/theme/common/colorRegistry.ts";
import type { IThemeFile } from "../../../../platform/theme/common/iThemeFile.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";

import { colorCustomizationsForTheme } from "./colorCustomizations.ts";
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
    private readonly extensionColors: Record<string, IColorDefinition> = {};
    private colorCustomizations: unknown = {};

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

    /**
     * A `contributes.colors` entry: its defaults go under every theme resolved from now on, so a theme
     * switch picks the slot of the new theme kind. Collisions are the contributor's business.
     */
    public registerColor(id: string, defaults: IColorDefaults, description: string): void {
        this.extensionColors[id] = { defaults, description };
    }

    /** The `workbench.colorCustomizations` value: every theme resolved from now on carries the blocks that name it. */
    public setColorCustomizations(setting: unknown): void {
        this.colorCustomizations = setting;
    }

    public resolve(label: string): WorkbenchTheme | undefined {
        const themeFile = this.themes.get(label);
        return themeFile === undefined
            ? undefined
            : WorkbenchTheme.fromThemeFile(
                  themeFile,
                  this.extensionColors,
                  colorCustomizationsForTheme(this.colorCustomizations, label),
              );
    }
}

export function createBuiltinThemeRegistry(): ThemeRegistry {
    return new ThemeRegistry(builtinThemes);
}
