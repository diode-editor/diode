import { formatHexColor } from "@tuidom/core/common/colorUtils";

import type { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";

/** Правило темы для vscode-textmate (`IRawThemeSetting`) — upstream `ITextMateThemingRule`. */
export interface ITextMateThemingRule {
    readonly name?: string;
    readonly scope?: string | readonly string[];
    readonly settings: {
        readonly foreground?: string;
        readonly background?: string;
        readonly fontStyle?: string;
    };
}

/**
 * `Registry.setTheme(theme, colorMap)`: colorMap — цвета по индексам из метаданных токенов
 * (`ColorId`). Индекс 1 — цвет текста редактора, 2 — фон, 0 — «нет цвета».
 */
export interface ITextMateTheme {
    readonly settings: readonly ITextMateThemingRule[];
    readonly colorMap: readonly string[];
}

/**
 * Upstream `ColorThemeData.tokenColors` + `tokenColorMap`: первое правило — без скоупа, цвета
 * текста и фона (`ColorId` 1 и 2); правила темы без скоупа отбрасываются — «умолчание» у эталона
 * одно. Не перенесено: `editor.tokenColorCustomizations` и цвета лог-токенов по умолчанию.
 */
export function createTextMateTheme(theme: WorkbenchTheme): ITextMateTheme {
    const settings: ITextMateThemingRule[] = [
        {
            settings: {
                foreground: editorColor(theme.colors["editor.foreground"]),
                background: editorColor(theme.colors["editor.background"]),
            },
        },
    ];
    for (const rule of theme.tokenTheme.rules) {
        if (rule.scope === undefined || rule.scope.length === 0) continue;
        settings.push({
            scope: rule.scope,
            settings: {
                foreground: normalizeColor(rule.settings.foreground),
                background: normalizeColor(rule.settings.background),
                fontStyle: rule.settings.fontStyle,
            },
        });
    }

    // Upstream `TokenColorIndex`: id с единицы, нулевой — пустой.
    const colorMap: string[] = [""];
    const seen = new Set<string>();
    const add = (color: string | undefined): void => {
        if (color === undefined || seen.has(color)) return;
        seen.add(color);
        colorMap.push(color);
    };
    for (const rule of settings) {
        add(rule.settings.foreground);
        add(rule.settings.background);
    }
    return { settings, colorMap };
}

/** Те же правила и тот же colorMap (upstream `equalsTokenRules` + `equalArray`); `undefined` — темы ещё не было. */
export function equalsTextMateTheme(a: ITextMateTheme | undefined, b: ITextMateTheme): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/** Тема из файла цвет имеет всегда (`WorkbenchTheme.fromThemeFile`); нет — vscode-textmate подставит свой. */
function editorColor(color: number | undefined): string | undefined {
    return color === undefined ? undefined : normalizeColor(formatHexColor(color));
}

/** Upstream `normalizeColor`: верхний регистр, короткая форма развёрнута, альфа `FF` снята; невалидный — `undefined`. */
export function normalizeColor(color: string | undefined): string | undefined {
    if (color === undefined || !/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) {
        return undefined;
    }
    let hex = color.slice(1).toUpperCase();
    if (hex.length <= 4) hex = hex.replace(/./g, (digit) => digit + digit);
    if (hex.length === 8 && hex.endsWith("FF")) hex = hex.slice(0, 6);
    return "#" + hex;
}
