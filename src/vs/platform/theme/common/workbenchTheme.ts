import { blendRgb } from "@tuidom/all/common/colorUtils";

import type { ColorContribution } from "./colorRegistry.ts";
import { themeKindOf } from "./colorRegistry.ts";
import { COLOR_CONTRIBUTIONS, defaultWorkbenchColors, type IWorkbenchColors } from "./colors/colorContributions.ts";
import { parseHexAlpha, parseHexColor } from "./colorUtils.ts";
import type { IEditorTokenTheme } from "./iEditorTokenTheme.ts";
import type { IThemeFile } from "./iThemeFile.ts";

/**
 * The active workbench color theme.
 * Holds packed RGB colors (converted from hex at load time)
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
     * its built-in defaults. See {@link defaultWorkbenchColors}.
     *
     * All hex color strings are converted to packed 24-bit RGB integers.
     * Colors declared with `blendOver` are composited onto their backdrop —
     * see {@link blendTransparentColors}.
     */
    public static fromThemeFile(json: IThemeFile): WorkbenchTheme {
        const merged = { ...defaultWorkbenchColors(themeKindOf(json.type)), ...json.colors };
        const colors: IWorkbenchColors = {};
        for (const [key, value] of Object.entries(merged)) {
            (colors as Record<string, number>)[key] = parseHexColor(value);
        }
        blendTransparentColors(colors, merged);

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
 * Второй проход по разобранной палитре: цвета, объявленные с `blendOver`,
 * накладываются на свою подложку долей альфы из исходной hex-строки.
 * Непрозрачное значение (и отсутствующая подложка) — no-op, поэтому запечённые
 * дефолты проходят насквозь; смысл прохода — темы, привезённые из upstream с
 * `#RRGGBBAA` (Dark Modern, Light Modern), где отброшенная альфа дала бы
 * нечитаемый фон.
 */
function blendTransparentColors(colors: IWorkbenchColors, source: Readonly<Record<string, string>>): void {
    const table = colors as Record<string, number>;
    const contributions: ColorContribution = COLOR_CONTRIBUTIONS;
    for (const [key, definition] of Object.entries(contributions)) {
        const backdrop = definition.blendOver;
        if (backdrop === undefined) continue;
        // Обе стороны наложения обязаны иметь дефолты — это инвариант реестра,
        // его сторожит colorContributions.test.ts, поэтому здесь их не проверяем.
        const alpha = parseHexAlpha(source[key]);
        if (alpha === 0xff) continue;
        table[key] = blendRgb(table[key], table[backdrop], alpha / 0xff);
    }
}
