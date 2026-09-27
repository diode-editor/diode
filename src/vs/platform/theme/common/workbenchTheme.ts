import { isColorReference, themeKindOf } from "./colorRegistry.ts";
import { defaultWorkbenchColors, type IWorkbenchColors } from "./colors/colorContributions.ts";
import { parseHexColor } from "./colorUtils.ts";
import type { IEditorTokenTheme } from "./iEditorTokenTheme.ts";
import type { IThemeFile } from "./iThemeFile.ts";

/**
 * The active workbench color theme.
 * Holds packed RGB/RGBA colors (converted from hex at load time)
 * and token rules for syntax highlighting.
 */
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
     * Create a WorkbenchTheme from a VS Code theme JSON object.
     *
     * The default color registry for the theme's kind (dark/light) is layered
     * UNDER the theme's own colors, so any workbench color the app reads
     * resolves on every theme — mirroring how VS Code fills unset colors from
     * its built-in defaults. See {@link defaultWorkbenchColors}. A default that
     * references another key (`quickInput.background` → `editorWidget.background`)
     * resolves against the merged table, so it follows the theme's value of the
     * base key — as VS Code's derived registry colors do.
     *
     * All hex color strings are converted to packed tuidom colors. Alpha is kept
     * as is (`#RRGGBBAA` → translucent value): compositing happens in the engine
     * at paint time, in draw order — see STYLES.md, «Модель цвета».
     */
    public static fromThemeFile(json: IThemeFile): WorkbenchTheme {
        const merged: Record<string, string> = { ...defaultWorkbenchColors(themeKindOf(json.type)), ...json.colors };
        const colors: IWorkbenchColors = {};
        for (const key of Object.keys(merged)) {
            (colors as Record<string, number>)[key] = parseHexColor(resolveReference(merged, key));
        }

        const tokenTheme: IEditorTokenTheme = {
            rules: json.tokenColors ?? [],
        };

        return new WorkbenchTheme(json.name ?? "Unnamed", json.type ?? "dark", colors, tokenTheme);
    }

    /**
     * Get an optional color by its VS Code key (e.g. `"editor.background"`).
     *
     * Returns `undefined` only for colors with no default in the registry —
     * genuinely optional overrides the consumer must handle (e.g.
     * `list.hoverForeground`, `editorGutter.background`). For chrome that must
     * always render, use {@link getRequiredColor}.
     */
    public getColor(key: keyof IWorkbenchColors): number | undefined {
        return this.colors[key];
    }

    /**
     * Get a required color by its VS Code key.
     *
     * Throws if the color is defined neither by the theme nor the default color
     * registry — a programming error meaning the key is missing from
     * the color definitions (`Theme/colors/*`). This enforces the invariant that every
     * color the app relies on has a default and resolves on every theme.
     */
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

/**
 * Hex-значение ключа с разрешением ссылок: дефолт вида `"editorWidget.background"`
 * берёт значение ЭТОГО ключа из той же таблицы (уже с цветами темы поверх
 * дефолтов), рекурсивно. Цикл или ссылка на незарегистрированный ключ —
 * ошибка определения цвета, а не темы (сторожит colorContributions.test.ts).
 */
function resolveReference(
    table: Readonly<Partial<Record<string, string>>>,
    key: string,
    trail: readonly string[] = [],
): string {
    const value = table[key];
    if (value === undefined) {
        throw new Error(`Color "${trail.at(-1) ?? key}" refers to unknown color "${key}"`);
    }
    if (!isColorReference(value)) return value;
    if (trail.includes(key)) {
        throw new Error(`Color reference cycle: ${[...trail, key].join(" → ")}`);
    }
    return resolveReference(table, value, [...trail, key]);
}
