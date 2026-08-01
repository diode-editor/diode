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

// ─── Состояния стиля ───
// Набор активных состояний элемента ведёт ядро (hover/focus) и виджеты
// (произвольные строковые: "selected", "checked", …). Стиль декларирует
// варианты для состояний — резолвит их каскад, а не render-код виджета.

export type StyleState = "hover" | "focus" | (string & {});

/**
 * Селектор состояния в when-записи:
 * - `"selected"` — состояние активно на САМОМ элементе;
 * - `"in:focus"` — активно на самом элементе ИЛИ любом предке («внутри
 *   сфокусированного»; заменяет descendant-комбинатор CSS). Осторожно:
 *   `in:hover` шире CSS-`:hover` — сработает и когда курсор на сиблинге
 *   внутри hovered-контейнера; «hover именно на мне» — простой `"hover"`.
 */
export type StyleStateSelector = StyleState | `in:${string}`;

/** Запись применяется, когда активны ВСЕ её селекторы (AND). */
export interface StyleStateVariant {
    readonly states: readonly StyleStateSelector[];
    readonly fg?: StyleColor;
    readonly bg?: StyleColor;
}

// ─── TUIStyle ───
// Declarative style set by the user on an element.
// All fields optional — undefined means "inherit from parent".

export interface TUIStyle {
    fg?: StyleColor;
    bg?: StyleColor;
    /**
     * Варианты по состояниям. Позже объявленная активная запись побеждает
     * (порядок = приоритет, как порядок правил CSS). `states: []` легален —
     * «всегда активна» (удобная база, переопределяемая последующими).
     */
    when?: readonly StyleStateVariant[];
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

// ─── Контекст резолва ───
// Всё, что течёт вниз по дереву при performStyleResolution.

export interface StyleResolutionContext {
    readonly fg: number;
    readonly bg: number;
    /** Объединение СОБСТВЕННЫХ состояний всех предков — для `in:`-селекторов. */
    readonly ancestorStates: ReadonlySet<string>;
}

const EMPTY_STATES: ReadonlySet<string> = new Set();

export const ROOT_STYLE_CONTEXT: StyleResolutionContext = {
    fg: DEFAULT_COLOR,
    bg: DEFAULT_COLOR,
    ancestorStates: EMPTY_STATES,
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
        if (key === "when") continue; // массив — структурно, ниже
        if (a[key] !== b[key]) return false;
    }
    return whenEquals(a.when, b.when);
}

// Порядок when-записей — семантика (приоритет), сравнение позиционное.
function whenEquals(a: readonly StyleStateVariant[] | undefined, b: readonly StyleStateVariant[] | undefined): boolean {
    if (a === b) return true;
    if (a === undefined || a.length !== b?.length) return false;
    for (let i = 0; i < a.length; i++) {
        const x = a[i];
        const y = b[i];
        if (x.fg !== y.fg || x.bg !== y.bg || x.states.length !== y.states.length) return false;
        for (let j = 0; j < x.states.length; j++) {
            if (x.states[j] !== y.states[j]) return false;
        }
    }
    return true;
}

// ─── Resolution functions ───

export function resolveStyleColor(color: StyleColor, inheritedFg: number, inheritedBg: number): number {
    if (color === INHERITED_FG) return inheritedFg;
    if (color === INHERITED_BG) return inheritedBg;
    return color;
}

/**
 * Схлопывает базовые fg/bg и активные when-записи в «применённые» сырые цвета
 * (ещё до резолва сентинелов). Позже объявленная активная запись побеждает.
 * undefined в результате = «наследовать».
 */
export function mergeStyleVariants(
    style: TUIStyle,
    isActive: (selector: StyleStateSelector) => boolean,
): { fg: StyleColor | undefined; bg: StyleColor | undefined } {
    let fg = style.fg;
    let bg = style.bg;
    if (style.when !== undefined) {
        for (const variant of style.when) {
            if (variant.states.every(isActive)) {
                if (variant.fg !== undefined) fg = variant.fg;
                if (variant.bg !== undefined) bg = variant.bg;
            }
        }
    }
    return { fg, bg };
}

export function resolveStyle(style: TUIStyle, inherited: ResolvedTUIStyle): ResolvedTUIStyle {
    const fg = style.fg !== undefined ? resolveStyleColor(style.fg, inherited.fg, inherited.bg) : inherited.fg;
    const bg = style.bg !== undefined ? resolveStyleColor(style.bg, inherited.fg, inherited.bg) : inherited.bg;

    return { fg, bg };
}
