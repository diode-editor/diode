import type { IThemeFile } from "./iThemeFile.ts";

/**
 * Counterpart of upstream `registerColor`, but an explicit merge of `COLOR_CONTRIBUTIONS` instead of
 * an import side effect. Two slots (dark/light); hc maps via {@link themeKindOf}. A default is hex
 * or a reference to another key, resolved over the theme colors: a theme that sets the base key
 * gets the derived ones too (otherwise the Catppuccin picker would stay gray). There are no
 * expressions (`transparent(ref, 0.5)`); such defaults are baked as hex.
 */

export interface IColorDefaults {
    readonly dark: string;
    readonly light: string;
}

export function isColorReference(value: string): boolean {
    return !value.startsWith("#");
}

export interface IColorDefinition {
    /** `null` means no default: the consumer must handle `undefined` (`getColor`, not `getRequiredColor`). */
    readonly defaults: IColorDefaults | null;
    readonly description: string;
}

export type ColorContribution = Readonly<Record<string, IColorDefinition>>;

export type ThemeKind = "dark" | "light";

export function themeKindOf(type: IThemeFile["type"]): ThemeKind {
    return type === "light" || type === "hcLight" ? "light" : "dark";
}

export function deriveDefaultColors(contributions: ColorContribution, kind: ThemeKind): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, definition] of Object.entries(contributions)) {
        if (definition.defaults !== null) {
            out[key] = definition.defaults[kind];
        }
    }
    return out;
}
