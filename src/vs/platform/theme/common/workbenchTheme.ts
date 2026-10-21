import { isColorReference, themeKindOf } from "./colorRegistry.ts";
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
     * Дефолты реестра для вида темы ложатся ПОД её цвета, как у VS Code, — любой цвет
     * резолвится на любой теме; ссылка в дефолте (`quickInput.background` →
     * `editorWidget.background`) разрешается уже по слитой таблице. Альфа сохраняется:
     * композитит движок при отрисовке (STYLES.md, «Модель цвета»).
     */
    public static fromThemeFile(json: IThemeFile): WorkbenchTheme {
        const merged: Record<string, string> = { ...defaultWorkbenchColors(themeKindOf(json.type)), ...json.colors };
        const colors: IWorkbenchColors = {};
        for (const key of Object.keys(merged)) {
            (colors as Record<string, number>)[key] = parseHexColor(resolveReference(merged, key));
        }

        const tokenTheme: IEditorTokenTheme = {
            rules: json.tokenColors ?? [],
            semanticHighlighting: json.semanticHighlighting === true,
            semanticTokenRules: json.semanticTokenRules ?? [],
        };

        return new WorkbenchTheme(json.name ?? "Unnamed", json.type ?? "dark", colors, tokenTheme);
    }

    /** `undefined` — только у цветов без дефолта в реестре; для обязательного хрома — {@link getRequiredColor}. */
    public getColor(key: keyof IWorkbenchColors): number | undefined {
        return this.colors[key];
    }

    /** Бросает, если ключа нет ни в теме, ни в дефолтах: цвет без определения — ошибка программиста. */
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

/** Ссылки — по цепочке; цикл или ссылка на незарегистрированный ключ — ошибка определения цвета (сторожит colorContributions.test.ts). */
function resolveReference(table: Readonly<Record<string, string>>, key: string): string {
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
