import type { IThemeFile } from "./iThemeFile.ts";

/**
 * Механика color-contributions (аналог `registerColor` vscode,
 * `vs/platform/theme/common/colorRegistry.ts`): цвет workbench-а объявляется
 * определением «ключ → дефолты (dark/light) + описание», сгруппированным по
 * областям в `Theme/colors/*.ts`; явный merge `COLOR_CONTRIBUTIONS`
 * (`Theme/colors/colorContributions.ts`) — наша конвенция вместо
 * side-effect-вызовов `registerColor` при импорте. Из определений деривируются
 * таблица дефолтов, слоящаяся ПОД цвета темы (`WorkbenchTheme.fromThemeFile`),
 * и типизация ключей (`WorkbenchColorKey`).
 *
 * Отличие от vscode: слота два (dark/light), не четыре — hc-темы мапятся на
 * ближайший вид через {@link themeKindOf}; derived-цвета (`transparent(ref, 0.5)`)
 * не поддержаны — терминальный рендер без альфы, композитные значения запекаются
 * в hex на месте определения. Единственная уступка альфе — {@link IColorDefinition.blendOver}:
 * тема-то приходит из upstream как есть и вполне может привезти `#RRGGBBAA`.
 */

export interface IColorDefaults {
    readonly dark: string;
    readonly light: string;
}

export interface IColorDefinition {
    /**
     * Hex-дефолты по виду темы, либо `null` — ключ зарегистрирован без
     * дефолта: значение даёт только тема, потребитель обязан обработать
     * `undefined` (`theme.getColor`, не `getRequiredColor`).
     */
    readonly defaults: IColorDefaults | null;
    /**
     * Ключ цвета-подложки для композитинга. Задаётся у цветов, которые темы
     * VS Code объявляют полупрозрачными (hover-фоны): значение с альфой
     * накладывается на уже разрезолвленную подложку, непрозрачное проходит
     * как есть. Без этого альфа просто отбрасывается и, например,
     * `statusBarItem.hoverBackground: "#F1F1F133"` из Dark Modern вырождается
     * в почти белый.
     */
    readonly blendOver?: string;
    /** Описание из каталога VS Code (см. theme-color reference). */
    readonly description: string;
}

/** Группа определений цветов: ключ VS Code → определение. */
export type ColorContribution = Readonly<Record<string, IColorDefinition>>;

export type ThemeKind = "dark" | "light";

/** Maps a theme's `type` (`dark` / `light` / `hc*`) to a default palette kind. */
export function themeKindOf(type: IThemeFile["type"]): ThemeKind {
    return type === "light" || type === "hcLight" ? "light" : "dark";
}

/** Таблица hex-дефолтов вида темы, деривированная из определений цветов. */
export function deriveDefaultColors(contributions: ColorContribution, kind: ThemeKind): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, definition] of Object.entries(contributions)) {
        if (definition.defaults !== null) {
            out[key] = definition.defaults[kind];
        }
    }
    return out;
}
