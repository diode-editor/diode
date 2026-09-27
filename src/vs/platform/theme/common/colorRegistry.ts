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
 * ближайший вид через {@link themeKindOf}. Дефолт — hex-строка либо **ссылка на
 * другой ключ** (`"quickInput.background": { dark: "editorWidget.background", … }`
 * — как `registerColor(id, editorWidgetBackground)` у vscode): разрешается уже
 * поверх цветов темы, так что тема, задавшая базовый ключ, получает и все
 * производные — иначе пикер Catppuccin оставался бы серым. Выражений над
 * цветами (`transparent(ref, 0.5)`) нет — такие дефолты запекаются hex-ом.
 * Альфа при этом штатная: `#RRGGBBAA` и в дефолте, и в теме уходит в палитру как
 * есть, а композитинг выполняет движок в порядке отрисовки (STYLES.md tuidom,
 * «Модель цвета»).
 */

/** Дефолт вида темы: hex-строка (`#RRGGBB[AA]`) либо ключ другого цвета реестра. */
export interface IColorDefaults {
    readonly dark: string;
    readonly light: string;
}

/** Ссылка ли это на другой ключ (а не hex-цвет). */
export function isColorReference(value: string): boolean {
    return !value.startsWith("#");
}

export interface IColorDefinition {
    /**
     * Hex-дефолты по виду темы, либо `null` — ключ зарегистрирован без
     * дефолта: значение даёт только тема, потребитель обязан обработать
     * `undefined` (`theme.getColor`, не `getRequiredColor`).
     */
    readonly defaults: IColorDefaults | null;
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
