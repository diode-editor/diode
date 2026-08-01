import { DEFAULT_COLOR } from "../../common/colorUtils.ts";

// ─── Inherited Color Sentinels ───
// Sentinel values that resolve to the inherited fg/bg from the parent.
// Start at -100 to avoid collision with DEFAULT_COLOR (-1).

export const INHERITED_FG = -100;
export const INHERITED_BG = -101;

// ─── StyleColor type ───
// A color value that can be:
// - packed 24-bit RGB (0x000000–0xFFFFFF)
// - DEFAULT_COLOR (-1): terminal default
// - INHERITED_FG (-100): resolve to parent's fg
// - INHERITED_BG (-101): resolve to parent's bg
export type StyleColor = number;

// ─── TUIStyle ───
// Declarative style set by the user on an element.
// All fields optional — undefined means "inherit from parent".

export interface TUIStyle {
    fg?: StyleColor;
    bg?: StyleColor;
}

// ─── ResolvedTUIStyle ───
// Fully resolved style with only concrete values (no undefined, no sentinels).

export interface ResolvedTUIStyle {
    readonly fg: number;
    readonly bg: number;
}

// ─── Root default ───

export const ROOT_RESOLVED_STYLE: ResolvedTUIStyle = {
    fg: DEFAULT_COLOR,
    bg: DEFAULT_COLOR,
};

// ─── Comparison ───

/**
 * Структурное равенство деклараций стиля. Используется сеттером `style`,
 * чтобы повторный пуш того же значения (JSX-rebuild, reconcile, повторное
 * применение темы) не помечал грязным всё поддерево.
 */
export function styleEquals(a: TUIStyle, b: TUIStyle): boolean {
    if (a === b) return true;
    // Сравниваются ВСЕ собственные ключи: подклассы расширяют стиль своими
    // полями (TitledPanelStyle.panelTitleFg), и они обязаны участвовать в
    // равенстве. Ключ с undefined против отсутствия ключа считается различием —
    // консервативно в безопасную сторону (лишний резолв, а не пропущенный).
    const aKeys = Object.keys(a) as (keyof TUIStyle)[];
    const bKeys = Object.keys(b) as (keyof TUIStyle)[];
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
        if (a[key] !== b[key]) return false;
    }
    return true;
}

// ─── Resolution functions ───

export function resolveStyleColor(color: StyleColor, inheritedFg: number, inheritedBg: number): number {
    if (color === INHERITED_FG) return inheritedFg;
    if (color === INHERITED_BG) return inheritedBg;
    return color;
}

export function resolveStyle(style: TUIStyle, inherited: ResolvedTUIStyle): ResolvedTUIStyle {
    const fg = style.fg !== undefined ? resolveStyleColor(style.fg, inherited.fg, inherited.bg) : inherited.fg;
    const bg = style.bg !== undefined ? resolveStyleColor(style.bg, inherited.fg, inherited.bg) : inherited.bg;

    return { fg, bg };
}
