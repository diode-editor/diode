import type { IThemeFile } from "./iThemeFile.ts";

/**
 * Аналог `registerColor` эталона, но явным merge `COLOR_CONTRIBUTIONS` вместо side-effect при
 * импорте. Слота два (dark/light), hc мапится через {@link themeKindOf}. Дефолт — hex либо
 * ссылка на другой ключ, разрешаемая поверх цветов темы: тема, задавшая базовый ключ, получает
 * и производные (иначе пикер Catppuccin оставался бы серым). Выражений (`transparent(ref, 0.5)`)
 * нет — такие дефолты запекаются hex-ом.
 */

export interface IColorDefaults {
    readonly dark: string;
    readonly light: string;
}

export function isColorReference(value: string): boolean {
    return !value.startsWith("#");
}

export interface IColorDefinition {
    /** `null` — дефолта нет: потребитель обязан обработать `undefined` (`getColor`, не `getRequiredColor`). */
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
