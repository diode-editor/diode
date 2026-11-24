import { type ColorContribution, deriveDefaultColors, isColorReference, themeKindOf } from "./colorRegistry.ts";
import { defaultWorkbenchColors, type IWorkbenchColors } from "./colors/colorContributions.ts";
import { parseHexColor } from "./colorUtils.ts";
import type { IEditorTokenTheme } from "./iEditorTokenTheme.ts";
import type { IThemeFile } from "./iThemeFile.ts";

export class WorkbenchTheme {
    public readonly name: string;
    public readonly type: "dark" | "light" | "hc" | "hcLight";
    public readonly colors: IWorkbenchColors;
    public readonly tokenTheme: IEditorTokenTheme;

    public constructor(
        name: string,
        type: "dark" | "light" | "hc" | "hcLight",
        colors: IWorkbenchColors,
        tokenTheme: IEditorTokenTheme,
    ) {
        this.name = name;
        this.type = type;
        this.colors = colors;
        this.tokenTheme = tokenTheme;
    }

    /**
     * Registry defaults for the theme kind go UNDER its colors, as in VS Code, so any color resolves
     * on any theme; a reference in a default (`quickInput.background` → `editorWidget.background`)
     * resolves against the merged table. Alpha is kept: the engine composites when painting
     * (tuidom STYLES.md, "Color model").
     *
     * `extensionColors` (`contributes.colors`) go under the registry defaults, so a built-in key always
     * wins. A broken reference in an extension color leaves that color unset instead of failing the theme
     * (the contributor has already logged it); the theme's own value for such a key wins as for any other.
     */
    public static fromThemeFile(json: IThemeFile, extensionColors: ColorContribution = {}): WorkbenchTheme {
        const kind = themeKindOf(json.type);
        const merged: Record<string, string> = {
            ...deriveDefaultColors(extensionColors, kind),
            ...defaultWorkbenchColors(kind),
            ...json.colors,
        };
        const colors: Record<string, number> = {};
        for (const key of Object.keys(merged)) {
            if (Object.hasOwn(extensionColors, key)) {
                const value = tryResolveReference(merged, key);
                if (value !== undefined) colors[key] = parseHexColor(value);
            } else {
                colors[key] = parseHexColor(resolveReference(merged, key));
            }
        }

        const tokenTheme: IEditorTokenTheme = {
            rules: json.tokenColors ?? [],
            semanticHighlighting: json.semanticHighlighting === true,
            semanticTokenRules: json.semanticTokenRules ?? [],
        };

        return new WorkbenchTheme(json.name ?? "Unnamed", json.type ?? "dark", colors as IWorkbenchColors, tokenTheme);
    }

    /** `undefined` only for colors without a registry default; for required chrome use {@link getRequiredColor}. */
    public getColor(key: keyof IWorkbenchColors): number | undefined {
        return this.colors[key];
    }

    /** Throws if the key is in neither the theme nor the defaults: an undefined color is a programmer error. */
    public getRequiredColor(key: keyof IWorkbenchColors): number {
        const color = this.colors[key];
        if (color === undefined) {
            throw new Error(
                `Workbench color "${key}" is not defined by theme "${this.name}" ` +
                    `and has no entry in the color definitions (src/Theme/colors/).`,
            );
        }
        return color;
    }
}

/** Follows references along the chain; a cycle or a reference to an unregistered key is a color definition error (guarded by colorContributions.test.ts). */
export function resolveReference(table: Readonly<Record<string, string>>, key: string): string {
    const trail = [key];
    let value = table[key];
    while (isColorReference(value)) {
        if (trail.includes(value)) {
            throw new Error(`Color reference cycle: ${[...trail, value].join(" → ")}`);
        }
        const next = (table as Readonly<Partial<Record<string, string>>>)[value];
        if (next === undefined) {
            throw new Error(`Color "${trail[trail.length - 1]}" refers to unknown color "${value}"`);
        }
        trail.push(value);
        value = next;
    }
    return value;
}

/** {@link resolveReference} for colors from extensions: a broken chain is `undefined`, not an error. */
function tryResolveReference(table: Readonly<Record<string, string>>, key: string): string | undefined {
    try {
        return resolveReference(table, key);
    } catch {
        return undefined;
    }
}
