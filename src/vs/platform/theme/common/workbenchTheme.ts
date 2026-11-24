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
     * wins. A broken reference (cycle, unknown key) leaves the color unset: for an extension color the
     * contributor has logged it, the built-in table is guarded by colorContributions.test.ts.
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
            const resolved = followReference(merged, key);
            if ("value" in resolved) colors[key] = parseHexColor(resolved.value);
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

/** Follows references along the chain to a hex value, or names why the chain is broken (a cycle, an unknown key). */
export function followReference(
    table: Readonly<Record<string, string>>,
    key: string,
): { readonly value: string } | { readonly problem: string } {
    const trail = [key];
    let value = table[key];
    while (isColorReference(value)) {
        if (trail.includes(value)) {
            return { problem: `Color reference cycle: ${[...trail, value].join(" → ")}` };
        }
        const next = (table as Readonly<Partial<Record<string, string>>>)[value];
        if (next === undefined) {
            return { problem: `Color "${trail[trail.length - 1]}" refers to unknown color "${value}"` };
        }
        trail.push(value);
        value = next;
    }
    return { value };
}
