import { formatHexColor } from "@tuidom/core/common/colorUtils";

import type { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";

/** Theme rule for vscode-textmate (`IRawThemeSetting`), upstream `ITextMateThemingRule`. */
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
 * `Registry.setTheme(theme, colorMap)`: colorMap holds colors by the indices in token metadata
 * (`ColorId`). Index 1 is the editor foreground, 2 the background, 0 "no color".
 */
export interface ITextMateTheme {
    readonly settings: readonly ITextMateThemingRule[];
    readonly colorMap: readonly string[];
}

/**
 * Upstream `ColorThemeData.tokenColors` + `tokenColorMap`: the first rule has no scope and holds the
 * foreground and background (`ColorId` 1 and 2); theme rules without a scope are dropped, since upstream
 * has a single default. Not ported: `editor.tokenColorCustomizations` and default log token colors.
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

    // Upstream `TokenColorIndex`: ids start at one, zero is empty.
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

/** Same rules and same colorMap (upstream `equalsTokenRules` + `equalArray`); `undefined` means no theme yet. */
export function equalsTextMateTheme(a: ITextMateTheme | undefined, b: ITextMateTheme): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/** A theme from a file always has a color (`WorkbenchTheme.fromThemeFile`); otherwise vscode-textmate substitutes its own. */
function editorColor(color: number | undefined): string | undefined {
    return color === undefined ? undefined : normalizeColor(formatHexColor(color));
}

/** Upstream `normalizeColor`: uppercase, short form expanded, `FF` alpha dropped; invalid yields `undefined`. */
export function normalizeColor(color: string | undefined): string | undefined {
    if (color === undefined || !/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) {
        return undefined;
    }
    let hex = color.slice(1).toUpperCase();
    if (hex.length <= 4) hex = hex.replace(/./g, (digit) => digit + digit);
    if (hex.length === 8 && hex.endsWith("FF")) hex = hex.slice(0, 6);
    return "#" + hex;
}
